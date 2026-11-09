import process from 'node:process'; import { Buffer } from 'node:buffer';
var __getOwnPropNames = Object.getOwnPropertyNames;
var __glob = (map) => (path) => {
  var fn = map[path];
  if (fn) return fn();
  throw new Error("Module not found in bundle: " + path);
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node-shim:node:crypto
import * as value from "node:crypto";
var require_node_crypto = __commonJS({
  "node-shim:node:crypto"(exports, module) {
    module.exports = value;
  }
});

// serverless/http.js
var require_http = __commonJS({
  "serverless/http.js"(exports, module) {
    var { timingSafeEqual } = require_node_crypto();
    function equalSecret(value7, expected) {
      if (!value7 || !expected) return false;
      const a = Buffer.from(value7), b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    }
    function eventsFrom(body) {
      if (!body || !Array.isArray(body.entry)) throw new Error("Invalid webhook envelope");
      const events = [];
      for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) throw new Error("Invalid changes");
        for (const change of entry.changes) {
          if (change.field === "smb_message_echoes") {
            for (const echo of change.value?.message_echoes || []) {
              if (echo.id && /^\d{7,15}$/.test(echo.to || "")) {
                events.push({
                  id: `echo:${echo.id}`,
                  customer_phone: echo.to,
                  kind: "echo",
                  payload: { ...change, value: { ...change.value, message_echoes: [echo] } }
                });
              }
            }
          } else {
            for (const message of change.value?.messages || []) {
              if (message.id && /^\d{7,15}$/.test(message.from || "") && ["text", "interactive"].includes(message.type)) {
                events.push({ id: message.id, customer_phone: message.from, kind: "message", payload: message });
              }
            }
          }
        }
      }
      if (events.length > 100) throw new Error("Too many messages");
      return events;
    }
    function createHandler({ store, drain, waitUntil, webhookSecret, workerSecret, enabled = false, prepare }) {
      return async (request) => {
        const route = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
        if (request.method === "GET" && route === "health") return Response.json({ status: "ok", runtime: "serverless", enabled });
        if (request.method !== "POST") return new Response("Not found", { status: 404 });
        const worker = route === "work" || route === "prepare";
        if (!worker && !["webhook", "whatsapp-bot"].includes(route)) return new Response("Not found", { status: 404 });
        if (!equalSecret(request.headers.get(worker ? "x-worker-secret" : "x-webhook-secret"), worker ? workerSecret : webhookSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (route === "prepare") {
          try {
            await prepare();
            return Response.json({ prepared: true });
          } catch {
            return new Response("Preparation failed", { status: 503 });
          }
        }
        if (!enabled) return new Response("Cutover not enabled", { status: 503 });
        if (worker) {
          waitUntil(drain().catch(() => console.error("Worker invocation failed")));
          return new Response("Accepted", { status: 202 });
        }
        let events;
        try {
          const text = await request.text();
          if (Buffer.byteLength(text) > 1e6) return new Response("Too large", { status: 413 });
          events = eventsFrom(JSON.parse(text));
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }
        try {
          if (events.length) await store.enqueue(events);
        } catch {
          return new Response("Storage unavailable", { status: 503 });
        }
        if (events.length) waitUntil(drain().catch(() => console.error("Worker invocation failed")));
        return new Response("OK", { status: 200 });
      };
    }
    module.exports = { createHandler, eventsFrom, equalSecret };
  }
});

// node-shim:node:async_hooks
import * as value2 from "node:async_hooks";
var require_node_async_hooks = __commonJS({
  "node-shim:node:async_hooks"(exports, module) {
    module.exports = value2;
  }
});

// serverless/context.js
var require_context = __commonJS({
  "serverless/context.js"(exports, module) {
    var { AsyncLocalStorage } = require_node_async_hooks();
    module.exports = new AsyncLocalStorage();
  }
});

// serverless/worker.js
var require_worker = __commonJS({
  "serverless/worker.js"(exports, module) {
    var context = require_context();
    function createWorker({ store, processMessage, recordEcho, now = Date.now, logger = console }) {
      return async function drain() {
        const deadline = now() + 95e3;
        for (let i = 0; i < 10 && now() < deadline; i++) {
          const job = await store.claim();
          if (!job) break;
          let state;
          try {
            state = await store.getState(job.customer_phone);
            await context.run({ job, state, store, ordinal: 0, deadline }, async () => {
              if (job.kind === "echo") await recordEcho(job.payload, state);
              else await processMessage(job.customer_phone, job.payload, state);
            });
            await store.finish(job, "done", state);
          } catch (error) {
            const status = error.deliveryUnknown ? "unknown" : "queued";
            await store.fail(job, status, error.code || "PROCESSING_FAILED", state);
            logger.error("Serverless message processing failed", { status, code: error.code || "PROCESSING_FAILED" });
          }
        }
      };
    }
    function createCheckpointedSender(post, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
      return async function send(url, payload, options) {
        const active = context.getStore();
        if (!active) throw new Error("Serverless sends require a claimed inbox message");
        const { job, store } = active;
        const ordinal = active.ordinal++;
        const receipt = await store.beginSend(job, ordinal, payload);
        if (receipt.status === "accepted") return receipt.response;
        if (receipt.status !== "ready") {
          throw Object.assign(new Error("Previous delivery outcome is uncertain"), { deliveryUnknown: true });
        }
        while (true) {
          const wait = await store.reserveSend(payload.to);
          if (now() + wait + 25e3 > active.deadline) {
            await store.rejectSend(job, ordinal);
            throw Object.assign(new Error("Invocation deadline approaching"), { code: "CONTINUE_LATER" });
          }
          if (wait <= 0) break;
          await sleep(wait);
        }
        let response;
        try {
          response = await post(url, payload, { ...options, timeout: 2e4 });
          if (!response?.data?.messages?.[0]?.id) {
            throw Object.assign(new Error("Provider returned no message ID"), { deliveryUnknown: true });
          }
        } catch (error) {
          const rejected = error.response?.status >= 400 && error.response?.status < 500 && error.response?.data?.error;
          if (rejected) await store.rejectSend(job, ordinal);
          else error.deliveryUnknown = true;
          error.isWhatsAppSendError = true;
          throw error;
        }
        try {
          await store.acceptSend(job, ordinal, response);
        } catch (error) {
          error.deliveryUnknown = true;
          throw error;
        }
        return response;
      };
    }
    module.exports = { createWorker, createCheckpointedSender };
  }
});

// serverless/store.js
var require_store = __commonJS({
  "serverless/store.js"(exports, module) {
    function createStore(db) {
      async function rpc(name, args) {
        const { data, error } = await db.rpc(name, args);
        if (error) throw error;
        return data;
      }
      return {
        enqueue: (events) => rpc("enqueue_bot_events", { p_events: events }),
        async claim() {
          return (await rpc("claim_bot_event", {}))?.[0] || null;
        },
        async getState(phone) {
          const { data, error } = await db.from("bot_conversations").select("state").eq("customer_phone", phone).maybeSingle();
          if (error) throw error;
          return data?.state || {};
        },
        finish: (job, status, state) => rpc("finish_bot_event", {
          p_id: job.id,
          p_token: job.claim_token,
          p_status: status,
          p_state: state,
          p_error: null
        }),
        fail: (job, status, error, state) => rpc("finish_bot_event", {
          p_id: job.id,
          p_token: job.claim_token,
          p_status: status,
          p_state: state || null,
          p_error: error
        }),
        beginSend: (job, ordinal, payload) => rpc("begin_bot_send", {
          p_id: job.id,
          p_token: job.claim_token,
          p_ordinal: ordinal,
          p_payload: payload
        }),
        reserveSend: (phone) => rpc("reserve_bot_send", { p_phone: phone }),
        acceptSend: (job, ordinal, response) => rpc("finish_bot_send", {
          p_id: job.id,
          p_token: job.claim_token,
          p_ordinal: ordinal,
          p_status: "accepted",
          p_response: { data: response.data }
        }),
        rejectSend: (job, ordinal) => rpc("finish_bot_send", {
          p_id: job.id,
          p_token: job.claim_token,
          p_ordinal: ordinal,
          p_status: "rejected",
          p_response: null
        })
      };
    }
    module.exports = { createStore };
  }
});

// shim:@supabase/supabase-js
import * as value3 from "npm:@supabase/supabase-js@2.109.0";
var require_supabase_js = __commonJS({
  "shim:@supabase/supabase-js"(exports, module) {
    module.exports = value3;
  }
});

// supabaseClient.js
var require_supabaseClient = __commonJS({
  "supabaseClient.js"(exports, module) {
    var { createClient } = require_supabase_js();
    module.exports = createClient(
      process.env.SUPABASE_URL,
      process.env.BOT_DATABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
});

// shim:dotenv
var require_dotenv = __commonJS({
  "shim:dotenv"(exports, module) {
    module.exports = { config() {
    } };
  }
});

// shim:express
var require_express = __commonJS({
  "shim:express"(exports, module) {
    function app() {
      return { use() {
      }, get() {
      }, post() {
      } };
    }
    app.json = () => () => {
    };
    module.exports = app;
  }
});

// shim:axios
import value4 from "npm:axios@1.20.0";
var require_axios = __commonJS({
  "shim:axios"(exports, module) {
    module.exports = value4;
  }
});

// bookingDateFlow.js
var require_bookingDateFlow = __commonJS({
  "bookingDateFlow.js"(exports, module) {
    var { randomUUID } = require_node_crypto();
    function createDateFlowMessage({ to, draft, dates, flowId, isChinese, now = Date.now() }) {
      if (!draft || !dates.length || !flowId) throw new Error("Missing booking date Flow configuration");
      draft.date_flow_token = randomUUID();
      draft.date_flow_expires_at = now + 30 * 6e4;
      return {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: isChinese ? "\u6253\u5F00\u65E5\u5386\u9009\u62E9\u9884\u7EA6\u65E5\u671F\uFF0C\u53EF\u63D0\u524D\u4E09\u4E2A\u6708\u9884\u7EA6\u3002" : "Open the calendar to choose a date up to three months ahead." },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: flowId,
              flow_token: draft.date_flow_token,
              flow_cta: isChinese ? "\u9009\u62E9\u65E5\u671F" : "Choose date",
              flow_action: "navigate",
              flow_action_payload: {
                screen: "BOOKING_DATE",
                data: {
                  min_date: dates[0],
                  max_date: dates.at(-1),
                  unavailable_dates: (() => {
                    const allowed = new Set(dates);
                    const excluded = [];
                    for (const day = /* @__PURE__ */ new Date(`${dates[0]}T00:00:00Z`); day.toISOString().slice(0, 10) <= dates.at(-1); day.setUTCDate(day.getUTCDate() + 1)) {
                      const date = day.toISOString().slice(0, 10);
                      if (!allowed.has(date)) excluded.push(date);
                    }
                    return excluded;
                  })(),
                  date_label: isChinese ? "\u9884\u7EA6\u65E5\u671F" : "Booking date",
                  helper_text: isChinese ? "\u9009\u62E9\u65E5\u671F\u540E\uFF0C\u70B9\u51FB\u7EE7\u7EED\u67E5\u770B\u53EF\u9884\u7EA6\u65F6\u6BB5\u3002" : "Choose a date, then continue to see available sessions.",
                  continue_label: isChinese ? "\u7EE7\u7EED" : "Continue"
                }
              }
            }
          }
        }
      };
    }
    function readDateFlowReply(responseJson, draft, dates, now = Date.now()) {
      let reply;
      try {
        reply = JSON.parse(responseJson);
      } catch {
        return null;
      }
      if (!reply || typeof reply !== "object" || !draft?.date_flow_token || reply.flow_token !== draft.date_flow_token || !Number.isFinite(draft.date_flow_expires_at) || now >= draft.date_flow_expires_at || typeof reply.booking_date !== "string" || !dates.includes(reply.booking_date)) {
        return null;
      }
      return reply.booking_date;
    }
    module.exports = { createDateFlowMessage, readDateFlowReply };
  }
});

// bookingSchedule.js
var require_bookingSchedule = __commonJS({
  "bookingSchedule.js"(exports, module) {
    var holidays = {
      2026: ["01-01", "02-17", "02-18", "03-21", "04-03", "05-01", "05-27", "05-31", "06-01", "08-09", "08-10", "11-08", "11-09", "12-25"],
      2027: ["01-01", "02-06", "02-07", "02-08", "03-10", "03-26", "05-01", "05-17", "05-20", "08-09", "10-28", "12-25"]
    };
    function isBookableDate(date) {
      const year = String(date).slice(0, 4);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Boolean(holidays[year]) && !holidays[year].includes(date.slice(5));
    }
    function formatTime(date) {
      return date.toLocaleTimeString("en-US", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).toLowerCase().replace(/\s/g, "");
    }
    function formatSessionHours(time, isChinese = false) {
      const start = /* @__PURE__ */ new Date(`2000-01-01T${String(time).slice(0, 5)}:00+08:00`);
      const end = new Date(start.getTime() + 90 * 6e4);
      const format = formatTime;
      return `${format(start)} - ${format(end)} (${isChinese ? "\u65B0\u52A0\u5761\u65F6\u95F4" : "Singapore time"})`;
    }
    function isRouteDateAllowed(date, route) {
      if (!isBookableDate(date)) return false;
      const day = (/* @__PURE__ */ new Date(`${date}T00:00:00+08:00`)).toLocaleDateString("en-US", { timeZone: "Asia/Singapore", weekday: "short" });
      if (route === "first_public") return true;
      if (route === "weekday") return ["Mon", "Tue", "Wed", "Thu"].includes(day);
      if (route === "weekend") return ["Fri", "Sat", "Sun"].includes(day);
      return route === "exclusive" || route === "premium" || route === "unlimited" || route === "no_package";
    }
    module.exports = Object.freeze({
      isRouteDateAllowed,
      isBookableDate,
      formatSessionHours,
      formatTime,
      startTimes: Object.freeze(["12:00", "14:00", "16:00"]),
      durationMinutes: 90
    });
  }
});

// whatsappProvider.js
var require_whatsappProvider = __commonJS({
  "whatsappProvider.js"(exports, module) {
    var MESSAGE_URL = "https://waba-v2.360dialog.io/messages";
    var GRAPH_VERSION = "v26.0";
    function providerConfig(env = process.env, { test = false } = {}) {
      const provider = test ? "meta" : env.WHATSAPP_PROVIDER || "360dialog";
      if (!["360dialog", "meta"].includes(provider)) throw new Error("Invalid WHATSAPP_PROVIDER");
      return {
        provider,
        version: env.META_GRAPH_API_VERSION || GRAPH_VERSION,
        apiKey: env.WHATSAPP_API_KEY,
        accessToken: env[test ? "META_TEST_ACCESS_TOKEN" : "META_ACCESS_TOKEN"],
        phoneNumberId: env[test ? "META_TEST_PHONE_NUMBER_ID" : "META_PHONE_NUMBER_ID"],
        wabaId: env[test ? "META_TEST_WABA_ID" : "META_WABA_ID"]
      };
    }
    function validateMeta(config) {
      if (!/^v\d+\.0$/.test(config.version) || !/^\d+$/.test(config.phoneNumberId || "") || !/^\d+$/.test(config.wabaId || "") || !config.accessToken || /\s/.test(config.accessToken))
        throw new Error("Meta requires a Graph version, access token, phone number ID and WABA ID");
    }
    function messageRequest(config, payload, options = {}) {
      if (config.provider === "360dialog") {
        if (!config.apiKey) throw new Error("WHATSAPP_API_KEY is required");
        const safeHeaders = Object.fromEntries(Object.entries(options.headers || {}).filter(([name]) => !["authorization", "d360-api-key"].includes(name.toLowerCase())));
        return [MESSAGE_URL, payload, { ...options, headers: {
          ...safeHeaders,
          "D360-API-KEY": config.apiKey,
          "Content-Type": "application/json"
        }, timeout: options.timeout || 3e4 }];
      }
      validateMeta(config);
      return [`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`, payload, {
        timeout: options.timeout || 3e4,
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" }
      }];
    }
    async function listTemplates(config, get) {
      if (config.provider === "360dialog") {
        const response = await get("https://waba-v2.360dialog.io/v1/configs/templates", {
          headers: { "D360-API-KEY": config.apiKey },
          timeout: 2e4
        });
        return response.data.waba_templates || [];
      }
      validateMeta(config);
      const rows = [];
      let after;
      for (let page = 0; page < 100; page++) {
        const response = await get(`https://graph.facebook.com/${config.version}/${config.wabaId}/message_templates`, {
          headers: { Authorization: `Bearer ${config.accessToken}` },
          timeout: 2e4,
          params: { fields: "name,language,status", limit: 100, ...after ? { after } : {} }
        });
        rows.push(...response.data.data || []);
        if (!response.data.paging?.next) return rows;
        const cursor = response.data.paging.cursors?.after;
        if (!cursor || cursor === after) throw new Error("Invalid Meta template pagination");
        after = cursor;
      }
      throw new Error("Too many Meta template pages");
    }
    module.exports = { MESSAGE_URL, GRAPH_VERSION, providerConfig, validateMeta, messageRequest, listTemplates };
  }
});

// whatsappSender.js
var require_whatsappSender = __commonJS({
  "whatsappSender.js"(exports, module) {
    var { createCheckpointedSender } = require_worker();
    var { providerConfig, messageRequest } = require_whatsappProvider();
    var axios = require_axios();
    var send = createCheckpointedSender((...args) => axios.post(...args));
    module.exports = {
      createWhatsAppSender: ({ post }) => createCheckpointedSender(post),
      postWhatsApp: (url, payload, options) => send(...messageRequest(providerConfig(), payload, options))
    };
  }
});

// metaWebhook.js
var require_metaWebhook = __commonJS({
  "metaWebhook.js"(exports, module) {
    var crypto = require_node_crypto();
    var { providerConfig, validateMeta } = require_whatsappProvider();
    function verifyMetaSignature(rawBody, signature, secret) {
      if (!Buffer.isBuffer(rawBody) || !secret || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
      return crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
    }
    function matchesAccount(body, config) {
      if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return false;
      return body.entry.every((entry) => String(entry.id) === config.wabaId && Array.isArray(entry.changes) && entry.changes.every((change) => {
        const value7 = change.value;
        if (!value7 || typeof value7 !== "object") return false;
        if (value7.messages && !Array.isArray(value7.messages)) return false;
        if (value7.statuses && !Array.isArray(value7.statuses)) return false;
        if (value7.messages?.length || value7.statuses?.length || change.field === "smb_message_echoes")
          return String(value7.metadata?.phone_number_id) === config.phoneNumberId;
        return !value7.metadata?.phone_number_id || String(value7.metadata.phone_number_id) === config.phoneNumberId;
      }));
    }
    function validateTestConfig(env) {
      const config = providerConfig(env, { test: true });
      validateMeta(config);
      const recipients = String(env.META_TEST_RECIPIENTS || "").split(",").map((p) => p.trim()).filter(Boolean);
      if (config.phoneNumberId === env.META_PHONE_NUMBER_ID || !env.META_TEST_VERIFY_TOKEN || !env.META_APP_SECRET || !recipients.length || recipients.some((p) => !/^\d{7,15}$/.test(p)))
        throw new Error("Meta test isolation is not configured");
      return config;
    }
    function metaAuthentication(config, { secret } = {}) {
      return (req, res, next) => {
        if (!verifyMetaSignature(req.rawBody, req.get("X-Hub-Signature-256"), secret)) return res.sendStatus(401);
        if (!matchesAccount(req.body, config)) return res.sendStatus(403);
        next();
      };
    }
    function mountMetaTestWebhook(app, { env = process.env, send, logger = console, now = Date.now, onStatus = () => {
    } } = {}) {
      const enabled = () => env.META_TEST_ENABLED === "true";
      const config = providerConfig(env, { test: true });
      const allowlist = new Set(String(env.META_TEST_RECIPIENTS || "").split(",").map((p) => p.trim()).filter(Boolean));
      const seen = /* @__PURE__ */ new Map();
      const available = (req, res, next) => {
        if (!enabled()) return res.sendStatus(404);
        try {
          validateMeta(config);
        } catch {
          return res.status(503).json({ error: "Meta test credentials are not configured" });
        }
        if (config.phoneNumberId === env.META_PHONE_NUMBER_ID || !env.META_TEST_VERIFY_TOKEN || !env.META_APP_SECRET || !allowlist.size || [...allowlist].some((p) => !/^\d{7,15}$/.test(p)))
          return res.status(503).json({ error: "Meta test isolation is not configured" });
        next();
      };
      app.get("/meta-test/webhook", available, (req, res) => {
        if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === env.META_TEST_VERIFY_TOKEN && typeof req.query["hub.challenge"] === "string") return res.status(200).send(req.query["hub.challenge"]);
        res.sendStatus(403);
      });
      app.post("/meta-test/webhook", available, metaAuthentication(config, { secret: env.META_APP_SECRET }), async (req, res) => {
        try {
          for (const entry of req.body.entry) for (const change of entry.changes) {
            for (const status of change.value.statuses || []) {
              if (allowlist.has(status.recipient_id)) onStatus(status);
            }
          }
          const messages = req.body.entry.flatMap((e) => e.changes.flatMap((c) => c.field === "messages" ? c.value.messages || [] : []));
          if (messages.some((m) => !allowlist.has(m.from) || typeof m.id !== "string")) return res.sendStatus(403);
          for (const [id, time] of seen) if (now() - time > 24 * 60 * 6e4) seen.delete(id);
          for (const message of messages) {
            if (seen.has(message.id)) continue;
            if (seen.size >= 1e4) return res.sendStatus(503);
            seen.set(message.id, now());
            await send({ messaging_product: "whatsapp", to: message.from, type: "text", text: {
              body: "Meta Cloud API test successful. Your live chatbot is still running through 360dialog. This test does not create bookings or use packages."
            } });
          }
          res.sendStatus(200);
        } catch (error) {
          logger.error("Meta test webhook send outcome requires review", {
            status: error.response?.status,
            code: error.code,
            metaCode: error.response?.data?.error?.code,
            metaSubcode: error.response?.data?.error?.error_subcode,
            metaType: error.response?.data?.error?.type
          });
          res.sendStatus(500);
        }
      });
    }
    module.exports = { verifyMetaSignature, matchesAccount, metaAuthentication, mountMetaTestWebhook, validateTestConfig };
  }
});

// templates/drafts/tea_session_reminder_full_en_v5.json
var require_tea_session_reminder_full_en_v5 = __commonJS({
  "templates/drafts/tea_session_reminder_full_en_v5.json"(exports, module) {
    module.exports = {
      name: "tea_session_reminder_full_en_v5",
      language: "en",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Dear Guests,\n\nAuthentic Tea Essence Museum\u2022Guanyiyangxing Tea Space welcomes you to our tea space tomorrow!\n\n\u{1F570}\uFE0F To help you plan your travel, here is tomorrow\u2019s schedule.\n\n{{1}} - {{2}}: Registration \n{{3}} - {{4}}: Tea Session introduction; take your seat and wait quietly for the session to begin \n{{5}}: Tea Session begins\n\nPlease note: To give everyone the best experience, we may not be able to admit late arrivals once the session has begun. Thank you for your understanding.\n\nPlease arrive 20 minutes early.\n\nGentle reminders: \n\u{1F455} Wear loose, comfortable tops and long pants suitable for sitting. Please wear socks for the session.\n \n\u{1F957} Avoid onion, ginger, garlic, curry, other spicy foods and alcohol. Please avoid eating for 1 hour before the session. \n\n\u{1F45A} You may perspire during the tea session. Bring a change of clothes if needed. \n\n\u{1F338} Please avoid wearing perfume. \n\nSee you tomorrow {{6}}! Have a lovely day ahead.",
          example: {
            body_text: [
              [
                "4:00pm",
                "4:15pm",
                "4:15pm",
                "4:30pm",
                "4:30pm",
                "afternoon"
              ]
            ]
          }
        }
      ]
    };
  }
});

// templates/drafts/tea_session_reminder_full_zh_v5.json
var require_tea_session_reminder_full_zh_v5 = __commonJS({
  "templates/drafts/tea_session_reminder_full_zh_v5.json"(exports, module) {
    module.exports = {
      name: "tea_session_reminder_full_zh_v5",
      language: "zh_CN",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "\u5C0A\u656C\u7684\u8336\u53CB\uFF1A\n\n\u8336\u4E4B\u76F8\u535A\u7269\u9986\u2022\u89C2\u9890\u517B\u6027\u8336\u7A7A\u95F4\u6B22\u8FCE\u60A8\u660E\u5929\u8385\u4E34\u6211\u4EEC\u7684\u8336\u7A7A\u95F4\uFF01\n\n\u{1F570}\uFE0F \u4E3A\u65B9\u4FBF\u60A8\u9884\u7559\u5145\u8DB3\u7684\u51FA\u884C\u65F6\u95F4\uFF0C\u4EE5\u4E0B\u662F\u660E\u5929\u7684\u6D3B\u52A8\u6D41\u7A0B\uFF1A\n\n{{1}} - {{2}}\uFF1A\u7B7E\u5230\n{{3}} - {{4}}\uFF1A\u8336\u835F\u4ECB\u7ECD\u53CA\u5165\u5EA7\u9759\u5F85\u8336\u835F\u5F00\u59CB\n{{5}}\uFF1A\u8336\u835F\u6B63\u5F0F\u5F00\u59CB\n\n\u6CE8\u610F\uFF1A\u4E3A\u4E86\u8BA9\u6BCF\u4F4D\u8336\u53CB\u90FD\u80FD\u4EAB\u6709\u6700\u4F73\u4F53\u9A8C\uFF0C\u8336\u835F\u5F00\u59CB\u540E\uFF0C\u6211\u4EEC\u53EF\u80FD\u65E0\u6CD5\u5B89\u6392\u8FDF\u5230\u7684\u8336\u53CB\u5165\u573A\uFF0C\u656C\u8BF7\u8C05\u89E3\u3002\n\n\u8BF7\u63D0\u524D20\u5206\u949F\u62B5\u8FBE\u3002\n\n\u6E29\u99A8\u63D0\u9192\uFF1A\n\u{1F455} \u8BF7\u7A7F\u5BBD\u677E\u8212\u9002\u3001\u9002\u5408\u9759\u5750\u7684\u4E0A\u8863\u548C\u957F\u88E4\u3002\u8336\u835F\u65F6\u95F4\u8BF7\u7A7F\u889C\u5B50\u3002\n\n\u{1F957} \u8BF7\u907F\u514D\u98DF\u7528\u8471\u3001\u59DC\u3001\u849C\u3001\u5496\u55B1\u53CA\u5176\u4ED6\u8F9B\u8FA3\u98DF\u7269\uFF0C\u907F\u514D\u996E\u9152\u3002\u6D3B\u52A8\u524D1\u5C0F\u65F6\u8BF7\u907F\u514D\u8FDB\u98DF\u3002\n\n\u{1F45A} \u8336\u835F\u53EF\u80FD\u6D41\u6C57\uFF0C\u82E5\u5FC5\u8981\u8BF7\u81EA\u884C\u643A\u5E26\u66F4\u6362\u7684\u8863\u7269\u3002\n\n\u{1F338} \u8BF7\u907F\u514D\u4F7F\u7528\u9999\u6C34\u3002\n\n\u660E\u5929{{6}}\u89C1\uFF01\u795D\u60A8\u6709\u6109\u5FEB\u7684\u4E00\u5929\u3002",
          example: {
            body_text: [
              [
                "4:00pm",
                "4:15pm",
                "4:15pm",
                "4:30pm",
                "4:30pm",
                "\u4E0B\u5348"
              ]
            ]
          }
        }
      ]
    };
  }
});

// require("./templates/drafts/tea_session_reminder_full_*_v5.json") in reminderRevision6.js
var globRequire_templates_drafts_tea_session_reminder_full___v5_json;
var init_ = __esm({
  'require("./templates/drafts/tea_session_reminder_full_*_v5.json") in reminderRevision6.js'() {
    globRequire_templates_drafts_tea_session_reminder_full___v5_json = __glob({
      "./templates/drafts/tea_session_reminder_full_en_v5.json": () => require_tea_session_reminder_full_en_v5(),
      "./templates/drafts/tea_session_reminder_full_zh_v5.json": () => require_tea_session_reminder_full_zh_v5()
    });
  }
});

// reminderDraft.js
var require_reminderDraft = __commonJS({
  "reminderDraft.js"(exports, module) {
    var { ADDRESS, DIRECTIONS_PDF, definitions: activeDefinitions } = require_reminderTemplates();
    var chinese = `\u5C0A\u656C\u7684\u8336\u53CB\uFF1A

\u8336\u4E4B\u76F8\u535A\u7269\u9986\u2022\u89C2\u9890\u517B\u6027\u8336\u7A7A\u95F4\u6B22\u8FCE\u60A8\u660E\u5929\u8385\u4E34\u6211\u4EEC\u7684\u8336\u7A7A\u95F4\uFF01

\u{1F570}\uFE0F \u4E3A\u65B9\u4FBF\u60A8\u9884\u7559\u5145\u8DB3\u7684\u51FA\u884C\u65F6\u95F4\uFF0C\u4EE5\u4E0B\u662F\u660E\u5929\u7684\u6D3B\u52A8\u6D41\u7A0B\uFF1A

{{1}} - {{2}}\uFF1A\u7B7E\u5230
{{3}} - {{4}}\uFF1A\u8336\u835F\u4ECB\u7ECD\u53CA\u5165\u5EA7\u9759\u5F85\u8336\u835F\u5F00\u59CB
{{5}}\uFF1A\u8336\u835F\u6B63\u5F0F\u5F00\u59CB

\u6CE8\u610F\uFF1A\u4E3A\u4E86\u8BA9\u6BCF\u4F4D\u8336\u53CB\u90FD\u80FD\u4EAB\u6709\u6700\u4F73\u4F53\u9A8C\uFF0C\u8336\u835F\u5F00\u59CB\u540E\uFF0C\u6211\u4EEC\u53EF\u80FD\u65E0\u6CD5\u5B89\u6392\u8FDF\u5230\u7684\u8336\u53CB\u5165\u573A\uFF0C\u656C\u8BF7\u8C05\u89E3\u3002

\u8BF7\u63D0\u524D20\u5206\u949F\u62B5\u8FBE\u3002

\u6E29\u99A8\u63D0\u9192\uFF1A
\u25CF\u8BF7\u7A7F\u5BBD\u677E\u8212\u9002\u3001\u9002\u5408\u9759\u5750\u7684\u4E0A\u8863\u548C\u957F\u88E4\u3002\u8336\u835F\u65F6\u95F4\u8BF7\u7A7F\u889C\u5B50\u3002
\u25CF\u8BF7\u907F\u514D\u98DF\u7528\u8471\u3001\u59DC\u3001\u849C\u3001\u5496\u55B1\u53CA\u5176\u4ED6\u8F9B\u8FA3\u98DF\u7269\uFF0C\u907F\u514D\u996E\u9152\u3002\u6D3B\u52A8\u524D1\u5C0F\u65F6\u8BF7\u907F\u514D\u8FDB\u98DF\u3002
\u25CF\u8336\u835F\u53EF\u80FD\u6D41\u6C57\uFF0C\u82E5\u5FC5\u8981\u8BF7\u81EA\u884C\u643A\u5E26\u66F4\u6362\u7684\u8863\u7269\u3002
\u25CF\u8BF7\u907F\u514D\u4F7F\u7528\u9999\u6C34\u3002
\u660E\u5929{{6}}\u89C1\uFF01\u795D\u60A8\u6709\u6109\u5FEB\u7684\u4E00\u5929\u3002`;
    var english = [
      "Dear Tea Friends,",
      "",
      "Authentic Tea Essence Museum\u2022Guanyiyangxing Tea Space welcomes you to our tea space tomorrow!",
      "",
      "\u{1F570}\uFE0F To help you plan your travel, here is tomorrow\u2019s schedule.",
      "",
      "{{1}} - {{2}}: Registration ",
      "{{3}} - {{4}}: Tea Session introduction; take your seat and wait quietly for the session to begin ",
      "{{5}}: Tea Session begins",
      "",
      "Please note: To give everyone the best experience, we may not be able to admit late arrivals once the session has begun. Thank you for your understanding.",
      "",
      "Please arrive 20 minutes early.",
      "",
      "Gentle reminders: ",
      "\u25CFWear loose, comfortable tops and long pants suitable for sitting. Please wear socks for the session.",
      " ",
      "\u25CFAvoid onion, ginger, garlic, curry, other spicy foods and alcohol. Please avoid eating for 1 hour before the session. ",
      "",
      "\u25CFYou may perspire during the tea session. Bring a change of clothes if needed. ",
      "",
      "\u25CFPlease avoid wearing perfume. ",
      "",
      "See you tomorrow {{6}}! Have a lovely day ahead."
    ].join("\n");
    var samples = ["4:00pm", "4:15pm", "4:15pm", "4:30pm", "4:30pm"];
    var definitions = [
      { name: "tea_session_reminder_full_en_v3", language: "en", category: "UTILITY", components: [{
        type: "BODY",
        text: english,
        example: { body_text: [[...samples, "afternoon"]] }
      }] },
      { name: "tea_session_reminder_full_zh_v3", language: "zh_CN", category: "UTILITY", components: [{
        type: "BODY",
        text: chinese,
        example: { body_text: [[...samples, "\u4E0B\u5348"]] }
      }] },
      structuredClone(activeDefinitions[2])
    ];
    function parameters(booking) {
      const start = /* @__PURE__ */ new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
      if (!Number.isFinite(start.getTime())) throw new Error("Invalid reminder session date/time");
      const intro = new Date(start.getTime() + 15 * 6e4), session = new Date(start.getTime() + 30 * 6e4);
      const times = [start, intro, intro, session, session].map((date) => date.toLocaleTimeString("en-US", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).toLowerCase().replace(/\s/g, ""));
      const hour = Number(start.toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", hourCycle: "h23" }));
      const period = hour < 12 ? 0 : hour < 18 ? 1 : 2;
      return [0, 1].map((i) => [...times, (i === 0 ? ["morning", "afternoon", "evening"] : ["\u4E0A\u5348", "\u4E0B\u5348", "\u665A\u4E0A"])[period]]);
    }
    function preview(booking) {
      const values = parameters(booking);
      return definitions.slice(0, 2).map((d, i) => d.components[0].text.replace(/\{\{(\d+)\}\}/g, (_, n) => values[i][Number(n) - 1]));
    }
    function sequence(booking) {
      const values = parameters(booking);
      return definitions.map((d, i) => ({ messaging_product: "whatsapp", to: booking.customer_phone, type: "template", template: {
        name: d.name,
        language: { code: d.language },
        components: i === 2 ? [{ type: "header", parameters: [{ type: "document", document: { link: DIRECTIONS_PDF, filename: "Directions.pdf" } }] }] : [{ type: "body", parameters: values[i].map((text) => ({ type: "text", text })) }]
      } }));
    }
    module.exports = { definitions, preview, sequence, ADDRESS, DIRECTIONS_PDF };
  }
});

// reminderRevision4.js
var require_reminderRevision4 = __commonJS({
  "reminderRevision4.js"(exports, module) {
    var previous = require_reminderDraft();
    var definitions = structuredClone(previous.definitions);
    definitions[0].name = "tea_session_reminder_full_en_v4";
    definitions[0].components[0].text = definitions[0].components[0].text.replace("Dear Tea Friends,", "Dear Guests,");
    definitions[1].name = "tea_session_reminder_full_zh_v4";
    definitions[1].components[0].text = `\u5C0A\u656C\u7684\u8336\u53CB\uFF1A

\u8336\u4E4B\u76F8\u535A\u7269\u9986\u2022\u89C2\u9890\u517B\u6027\u8336\u7A7A\u95F4\u6B22\u8FCE\u60A8\u660E\u5929\u8385\u4E34\u6211\u4EEC\u7684\u8336\u7A7A\u95F4\uFF01

\u{1F570}\uFE0F \u4E3A\u65B9\u4FBF\u60A8\u9884\u7559\u5145\u8DB3\u7684\u51FA\u884C\u65F6\u95F4\uFF0C\u4EE5\u4E0B\u662F\u660E\u5929\u7684\u6D3B\u52A8\u6D41\u7A0B\uFF1A

{{1}} - {{2}}\uFF1A\u7B7E\u5230
{{3}} - {{4}}\uFF1A\u8336\u835F\u4ECB\u7ECD\u53CA\u5165\u5EA7\u9759\u5F85\u8336\u835F\u5F00\u59CB
{{5}}\uFF1A\u8336\u835F\u6B63\u5F0F\u5F00\u59CB

\u6CE8\u610F\uFF1A\u4E3A\u4E86\u8BA9\u6BCF\u4F4D\u8336\u53CB\u90FD\u80FD\u4EAB\u6709\u6700\u4F73\u4F53\u9A8C\uFF0C\u8336\u835F\u5F00\u59CB\u540E\uFF0C\u6211\u4EEC\u53EF\u80FD\u65E0\u6CD5\u5B89\u6392\u8FDF\u5230\u7684\u8336\u53CB\u5165\u573A\uFF0C\u656C\u8BF7\u8C05\u89E3\u3002

\u8BF7\u63D0\u524D20\u5206\u949F\u62B5\u8FBE\u3002

\u6E29\u99A8\u63D0\u9192\uFF1A
\u25CF\u8BF7\u7A7F\u5BBD\u677E\u8212\u9002\u3001\u9002\u5408\u9759\u5750\u7684\u4E0A\u8863\u548C\u88E4\u5B50\u3002\u8336\u835F\u65F6\u95F4\u8BF7\u7A7F\u889C\u5B50\u3002

\u25CF\u8BF7\u907F\u514D\u98DF\u7528\u8471\u3001\u59DC\u3001\u849C\u3001\u5496\u55B1\u53CA\u5176\u4ED6\u8F9B\u8FA3\u98DF\u7269\uFF0C\u907F\u514D\u996E\u9152\u3002\u6D3B\u52A8\u524D1\u5C0F\u65F6\u8BF7\u907F\u514D\u8FDB\u98DF\u3002

\u25CF\u8336\u835F\u53EF\u80FD\u6D41\u6C57\uFF0C\u82E5\u5FC5\u8981\u8BF7\u81EA\u884C\u643A\u5E26\u66F4\u6362\u7684\u8863\u7269\u3002

\u25CF\u8BF7\u907F\u514D\u4F7F\u7528\u9999\u6C34\u3002

\u660E\u5929{{6}}\u89C1\uFF01\u795D\u60A8\u4ECA\u5929\u8FC7\u5F97\u6109\u5FEB\u3002`;
    function sequence(booking) {
      const payloads = previous.sequence(booking);
      for (let i = 0; i < 2; i++) payloads[i].template.name = definitions[i].name;
      return payloads;
    }
    function preview(booking) {
      const payloads = sequence(booking);
      return definitions.slice(0, 2).map((d, i) => d.components[0].text.replace(/\{\{(\d+)\}\}/g, (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text));
    }
    module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
  }
});

// reminderRevision5.js
var require_reminderRevision5 = __commonJS({
  "reminderRevision5.js"(exports, module) {
    var previous = require_reminderRevision4();
    var definitions = structuredClone(previous.definitions);
    var icons = ["\u{1F455}", "\u{1F957}", "\u{1F45A}", "\u{1F338}"];
    for (let i = 0; i < 2; i++) {
      definitions[i].name = definitions[i].name.replace(/_v4$/, "_v5");
      let point = 0;
      definitions[i].components[0].text = definitions[i].components[0].text.replace(/^●/gm, () => icons[point++] + " ");
    }
    function sequence(booking) {
      const payloads = previous.sequence(booking);
      for (let i = 0; i < 2; i++) payloads[i].template.name = definitions[i].name;
      return payloads;
    }
    function preview(booking) {
      const payloads = sequence(booking);
      return definitions.slice(0, 2).map((d, i) => d.components[0].text.replace(
        /\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text
      ));
    }
    module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
  }
});

// reminderRevision6.js
var require_reminderRevision6 = __commonJS({
  "reminderRevision6.js"(exports, module) {
    init_();
    var previous = require_reminderRevision5();
    var definitions = ["en", "zh"].map((language) => {
      const definition = structuredClone(globRequire_templates_drafts_tea_session_reminder_full___v5_json(`./templates/drafts/tea_session_reminder_full_${language}_v5.json`));
      definition.name = definition.name.replace(/_v5$/, "_v6");
      return definition;
    });
    definitions.push(structuredClone(previous.definitions[2]));
    function sequence(booking) {
      const payloads = previous.sequence(booking);
      for (let i = 0; i < 2; i++) payloads[i].template.name = definitions[i].name;
      return payloads;
    }
    function preview(booking) {
      const payloads = sequence(booking);
      return definitions.slice(0, 2).map((definition, i) => definition.components[0].text.replace(
        /\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text
      ));
    }
    module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
  }
});

// reminderRevision7.js
var require_reminderRevision7 = __commonJS({
  "reminderRevision7.js"(exports, module) {
    var previous = require_reminderRevision6();
    var definitions = structuredClone(previous.definitions);
    var english = definitions[0];
    english.name = "tea_session_reminder_full_en_v7";
    english.components[0].text = english.components[0].text.replace(/🕰️[^]*?(?=Please note:)/, "\u{1F570}\uFE0F Please arrive 10\u201320 minutes before your session to allow time for registration and use of the restroom.\n\n").replace("Please arrive 20 minutes early.\n\n", "").replace("{{6}}", "{{1}}");
    english.components[0].example.body_text = [["afternoon"]];
    var chinese = definitions[1];
    chinese.name = "tea_session_reminder_full_zh_v7";
    chinese.components[0].text = chinese.components[0].text.replace(/🕰️[^]*?(?=注意：)/, "\u{1F570}\uFE0F \u8BF7\u4E8E\u8336\u835F\u5F00\u59CB\u524D10\u201320\u5206\u949F\u62B5\u8FBE\uFF0C\u4EE5\u4FBF\u7B7E\u5230\u53CA\u4F7F\u7528\u6D17\u624B\u95F4\u3002\n\n").replace("\u8BF7\u63D0\u524D20\u5206\u949F\u62B5\u8FBE\u3002\n\n", "").replace("{{6}}", "{{1}}");
    chinese.components[0].example.body_text = [["\u4E0B\u5348"]];
    function sequence(booking) {
      const payloads = previous.sequence(booking);
      for (let i = 0; i < 2; i++) {
        const period = payloads[i].template.components[0].parameters.at(-1);
        payloads[i].template.name = definitions[i].name;
        payloads[i].template.components[0].parameters = [period];
      }
      return payloads;
    }
    function preview(booking) {
      const payloads = sequence(booking);
      return definitions.slice(0, 2).map((definition, i) => definition.components[0].text.replace(
        /\{\{(\d+)\}\}/g,
        (_, n) => payloads[i].template.components[0].parameters[Number(n) - 1].text
      ));
    }
    module.exports = { definitions, sequence, preview, ADDRESS: previous.ADDRESS, DIRECTIONS_PDF: previous.DIRECTIONS_PDF };
  }
});

// reminderTemplates.js
var require_reminderTemplates = __commonJS({
  "reminderTemplates.js"(exports, module) {
    var ADDRESS = "RRoyce Building, 65 Mohamed Sultan Rd, Level 3, Singapore 239003";
    var DIRECTIONS_PDF = "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/Getting%20to%20the%20RROYCE%20Building.pdf.pdf";
    var english = `Dear Guest,

Authentic Tea Essence Museum\u2022Guanyiyangxing Tea Space is truly looking forward to welcoming you to our tea space tomorrow!

\u{1F570}\uFE0F To help you buffer your time tomorrow, here is a quick look at our timeline:

{{1}} - {{2}}: Welcome & Registration
{{3}} - {{4}}: Intro & Seating starts promptly
{{5}}: Session begins

To give every participant the best experience, we kindly ask that you arrive by {{6}}.
Unfortunately, we may not be able to admit late arrivals once the session is underway.

Please arrive 20 minutes early.

Gentle reminder:
\u25CFWear socks and loose, comfortable clothing for sitting.
\u25CFAvoid onion, ginger, garlic, curry, and other spicy foods.
\u25CFRefrain from using heavy perfumes.
\u25CFAvoid heavy meals 1 hour prior.
See you tomorrow {{7}}! Have a lovely day ahead.`;
    var chinese = `\u5C0A\u656C\u7684\u6765\u5BBE\uFF1A

\u8336\u4E4B\u76F8\u535A\u7269\u9986\u2022\u89C2\u9890\u517B\u6027\u8336\u7A7A\u95F4\u6EE1\u6000\u671F\u5F85\uFF0C\u6B22\u8FCE\u60A8\u660E\u5929\u8385\u4E34\u6211\u4EEC\u7684\u8336\u7A7A\u95F4\uFF01

\u{1F570}\uFE0F \u4E3A\u65B9\u4FBF\u60A8\u9884\u7559\u5145\u8DB3\u7684\u51FA\u884C\u65F6\u95F4\uFF0C\u4EE5\u4E0B\u662F\u660E\u5929\u7684\u6D3B\u52A8\u6D41\u7A0B\uFF1A

{{1}} - {{2}}\uFF1A\u6B22\u8FCE\u4E0E\u7B7E\u5230
{{3}} - {{4}}\uFF1A\u6D3B\u52A8\u4ECB\u7ECD\u4E0E\u5165\u5EA7\uFF0C\u51C6\u65F6\u5F00\u59CB
{{5}}\uFF1A\u8336\u4F1A\u6B63\u5F0F\u5F00\u59CB

\u4E3A\u4E86\u8BA9\u6BCF\u4F4D\u6765\u5BBE\u90FD\u80FD\u4EAB\u6709\u6700\u4F73\u4F53\u9A8C\uFF0C\u656C\u8BF7\u60A8\u4E8E{{6}}\u524D\u62B5\u8FBE\u3002
\u6D3B\u52A8\u5F00\u59CB\u540E\uFF0C\u6211\u4EEC\u53EF\u80FD\u65E0\u6CD5\u5B89\u6392\u8FDF\u5230\u7684\u6765\u5BBE\u5165\u573A\uFF0C\u656C\u8BF7\u8C05\u89E3\u3002

\u8BF7\u63D0\u524D20\u5206\u949F\u62B5\u8FBE\u3002

\u6E29\u99A8\u63D0\u9192\uFF1A
\u25CF\u8BF7\u7A7F\u889C\u5B50\u53CA\u5BBD\u677E\u8212\u9002\u3001\u9002\u5408\u9759\u5750\u7684\u8863\u7269\u3002
\u25CF\u8BF7\u907F\u514D\u98DF\u7528\u8471\u3001\u59DC\u3001\u849C\u3001\u5496\u55B1\u53CA\u5176\u4ED6\u8F9B\u8FA3\u98DF\u7269\u3002
\u25CF\u8BF7\u907F\u514D\u4F7F\u7528\u6D53\u70C8\u7684\u9999\u6C34\u3002
\u25CF\u6D3B\u52A8\u524D1\u5C0F\u65F6\u8BF7\u907F\u514D\u5927\u91CF\u8FDB\u98DF\u3002
\u660E\u5929{{7}}\u89C1\uFF01\u795D\u60A8\u6709\u6109\u5FEB\u7684\u4E00\u5929\u3002`;
    function bodyDefinition(name, language, text, samples) {
      return { name, language, category: "UTILITY", components: [{
        type: "BODY",
        text,
        example: { body_text: [samples] }
      }] };
    }
    var definitions = [
      bodyDefinition(
        "tea_session_reminder_full_en_v2",
        "en",
        english,
        ["4:00 PM", "4:15 PM", "4:15 PM", "4:30 PM", "4:30 PM", "4:30 PM", "afternoon"]
      ),
      bodyDefinition(
        "tea_session_reminder_full_zh_v2",
        "zh_CN",
        chinese,
        ["\u4E0B\u53484:00", "\u4E0B\u53484:15", "\u4E0B\u53484:15", "\u4E0B\u53484:30", "\u4E0B\u53484:30", "\u4E0B\u53484:30", "\u4E0B\u5348"]
      ),
      { name: "tea_session_directions_v2", language: "en", category: "UTILITY", components: [
        { type: "HEADER", format: "DOCUMENT", example: { header_handle: [DIRECTIONS_PDF] } },
        { type: "BODY", text: `Directions for your booked tea session / \u8336\u4F1A\u4EA4\u901A\u6307\u5357

${ADDRESS}` }
      ] }
    ];
    function reminderSequence(booking, format = "full_v2") {
      if (format === "full_v7") return require_reminderRevision7().sequence(booking);
      if (format === "full_v6") return require_reminderRevision6().sequence(booking);
      if (format === "full_v5") return require_reminderRevision5().sequence(booking);
      if (format === "full_v4") return require_reminderRevision4().sequence(booking);
      if (format === "full_v3") return require_reminderDraft().sequence(booking);
      const start = /* @__PURE__ */ new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
      if (!Number.isFinite(start.getTime())) throw new Error("Invalid reminder session date/time");
      const intro = new Date(start.getTime() + 15 * 6e4), session = new Date(start.getTime() + 30 * 6e4);
      const dates = [start, intro, intro, session, session, session];
      const hour = Number(start.toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", hourCycle: "h23" }));
      const period = hour < 12 ? 0 : hour < 18 ? 1 : 2;
      const periods = [["morning", "afternoon", "evening"], ["\u4E0A\u5348", "\u4E0B\u5348", "\u665A\u4E0A"]];
      return definitions.map((definition, i) => ({
        messaging_product: "whatsapp",
        to: booking.customer_phone,
        type: "template",
        template: {
          name: definition.name,
          language: { code: definition.language },
          components: i === 2 ? [{ type: "header", parameters: [{ type: "document", document: { link: DIRECTIONS_PDF, filename: "Directions.pdf" } }] }] : [{ type: "body", parameters: [...dates.map((date) => date.toLocaleTimeString("en-US", {
            timeZone: "Asia/Singapore",
            hour: "numeric",
            minute: "2-digit",
            hour12: true
          }).toLowerCase().replace(/\s/g, "")), periods[i][period]].map((text) => ({ type: "text", text })) }]
        }
      }));
    }
    function getDefinitions(format = "full_v2") {
      if (format === "full_v7") return require_reminderRevision7().definitions;
      if (format === "full_v6") return require_reminderRevision6().definitions;
      if (format === "full_v5") return require_reminderRevision5().definitions;
      if (format === "full_v4") return require_reminderRevision4().definitions;
      return format === "full_v3" ? require_reminderDraft().definitions : definitions;
    }
    module.exports = { ADDRESS, DIRECTIONS_PDF, definitions, getDefinitions, reminderSequence };
  }
});

// bookingDatabase.js
var require_bookingDatabase = __commonJS({
  "bookingDatabase.js"(exports, module) {
    var supabase = require_supabaseClient();
    var BOOKING_CONFIG = require_bookingSchedule();
    async function getDraft(customerPhone) {
      const { data, error } = await supabase.from("booking_drafts").select("draft").eq("customer_phone", customerPhone).maybeSingle();
      if (error) throw error;
      return data?.draft || null;
    }
    async function saveDraft(draft) {
      const { error } = await supabase.from("booking_drafts").upsert({ customer_phone: draft.customer_phone, draft, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      if (error) throw error;
      return draft;
    }
    async function startBooking(customerPhone) {
      return saveDraft({ customer_phone: customerPhone, booking_date: null, booking_time: null, party_size: null, package_request_id: require_node_crypto().randomUUID() });
    }
    async function saveBookingDate(customerPhone, date) {
      if (!BOOKING_CONFIG.isBookableDate(date)) {
        throw new Error("Booking is closed on Singapore public holidays or unverified years");
      }
      const draft = await getDraft(customerPhone);
      if (!draft) {
        throw new Error("Booking draft not found");
      }
      if (draft.journey_step !== "dates" || !BOOKING_CONFIG.isRouteDateAllowed(date, draft.booking_route)) {
        throw new Error("Date is not allowed for this booking category");
      }
      if (draft.reserved_booking_id) throw new Error("Booking already reserved; start a new booking to change details");
      draft.package_request_id = require_node_crypto().randomUUID();
      draft.booking_date = date;
      draft.booking_time = null;
      draft.party_size = null;
      return saveDraft(draft);
    }
    async function saveBookingTime(customerPhone, time) {
      if (!BOOKING_CONFIG.startTimes.includes(time)) {
        throw new Error("Invalid booking session time");
      }
      const draft = await getDraft(customerPhone);
      if (!draft || !draft.booking_date) {
        throw new Error("Booking date not selected");
      }
      if (!BOOKING_CONFIG.isRouteDateAllowed(draft.booking_date, draft.booking_route)) {
        throw new Error("Date is not allowed for this booking category");
      }
      if (draft.reserved_booking_id) throw new Error("Booking already reserved; start a new booking to change details");
      draft.package_request_id = require_node_crypto().randomUUID();
      draft.booking_time = time;
      draft.party_size = null;
      return saveDraft(draft);
    }
    async function savePartySize(customerPhone, partySize) {
      const draft = await getDraft(customerPhone);
      if (!draft || !draft.booking_date || !draft.booking_time) {
        throw new Error("Booking date or time not selected");
      }
      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
        throw new Error("Invalid party size");
      }
      if (draft.reserved_booking_id) throw new Error("Booking already reserved; start a new booking to change details");
      draft.package_request_id = require_node_crypto().randomUUID();
      draft.party_size = partySize;
      return saveDraft(draft);
    }
    async function submitBooking(customerPhone) {
      const draft = await getDraft(customerPhone);
      if (!draft || !draft.booking_date || !draft.booking_time || !draft.party_size) {
        throw new Error("Booking details are incomplete");
      }
      if (!BOOKING_CONFIG.startTimes.includes(String(draft.booking_time).slice(0, 5))) {
        throw new Error("That session time is no longer offered");
      }
      if (!BOOKING_CONFIG.isBookableDate(draft.booking_date)) {
        throw new Error("Booking is closed on Singapore public holidays or unverified years");
      }
      if (draft.journey_step !== "dates" || !BOOKING_CONFIG.isRouteDateAllowed(draft.booking_date, draft.booking_route)) {
        throw new Error("Date is not allowed for this booking category");
      }
      if (!draft.package_request_id) {
        draft.package_request_id = require_node_crypto().randomUUID();
        await saveDraft(draft);
      }
      const { data: bookingId, error } = await supabase.rpc("reserve_booking_with_completion", {
        p_customer_phone: customerPhone,
        p_booking_date: draft.booking_date,
        p_booking_time: draft.booking_time,
        p_party_size: draft.party_size,
        p_booking_route: draft.booking_route,
        p_request_id: draft.package_request_id,
        p_language: draft.language || "en"
      });
      if (error) {
        throw error;
      }
      const { data: booking, error: fetchError } = await supabase.from("booking_requests").select(`
            id,
            customer_phone,
            party_size,
            status,
            session_id,
            booking_sessions (
                booking_date,
                booking_time
            )
        `).eq("id", bookingId).single();
      if (fetchError) {
        throw new Error(
          `Booking ${bookingId} was reserved, but could not be fetched: ` + fetchError.message
        );
      }
      draft.reserved_booking_id = bookingId;
      await saveDraft(draft);
      return {
        ...booking,
        booking_date: booking.booking_sessions.booking_date,
        booking_time: booking.booking_sessions.booking_time
      };
    }
    async function cancelDraft(customerPhone) {
      const { error } = await supabase.from("booking_drafts").delete().eq("customer_phone", customerPhone);
      if (error) throw error;
      return true;
    }
    async function getBookingById(bookingId) {
      const { data, error } = await supabase.from("booking_requests").select(`
            id,
            customer_phone,
            party_size,
            status,
            session_id,
            booking_sessions (
                booking_date,
                booking_time
            )
        `).eq("id", bookingId).maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }
      return {
        ...data,
        booking_date: data.booking_sessions.booking_date,
        booking_time: data.booking_sessions.booking_time
      };
    }
    async function rejectBooking(bookingId) {
      const { data, error } = await supabase.rpc(
        "reject_booking",
        {
          p_booking_id: bookingId
        }
      );
      if (error) {
        throw error;
      }
      return data === true;
    }
    async function getSessionAvailability(bookingDate) {
      const { data, error } = await supabase.from("booking_sessions").select(
        "id, booking_time, capacity, reserved_places"
      ).eq("booking_date", bookingDate);
      if (error) {
        throw error;
      }
      return data || [];
    }
    async function getSessionAvailabilityRange(firstDate, lastDate) {
      const rows = [];
      for (let offset = 0; ; offset += 1e3) {
        const { data, error } = await supabase.from("booking_sessions").select("id, booking_date, booking_time, capacity, reserved_places").gte("booking_date", firstDate).lte("booking_date", lastDate).order("id").range(offset, offset + 999);
        if (error) throw error;
        rows.push(...data || []);
        if (!data || data.length < 1e3) return rows;
      }
    }
    async function markSessionCalendarSynced(sessionId, calendarEventId) {
      const { error } = await supabase.rpc(
        "mark_session_calendar_synced",
        {
          p_session_id: sessionId,
          p_calendar_event_id: calendarEventId
        }
      );
      if (error) {
        throw error;
      }
    }
    async function getUnsyncedSessions() {
      const { data, error } = await supabase.from("booking_sessions").select(
        "id, booking_date, booking_time, reserved_places, calendar_event_id, calendar_sync_status"
      ).gt("reserved_places", 0).or("calendar_sync_status.neq.synced,calendar_event_id.is.null");
      if (error) {
        throw error;
      }
      return data || [];
    }
    async function getBookingSession(sessionId) {
      const { data, error } = await supabase.from("booking_sessions").select(
        "id, capacity, reserved_places, calendar_event_id"
      ).eq("id", sessionId).single();
      if (error) {
        throw error;
      }
      return data;
    }
    module.exports = {
      getDraft,
      saveDraft,
      startBooking,
      saveBookingDate,
      saveBookingTime,
      savePartySize,
      submitBooking,
      cancelDraft,
      getBookingById,
      rejectBooking,
      getSessionAvailability,
      getSessionAvailabilityRange,
      markSessionCalendarSynced,
      getUnsyncedSessions,
      getBookingSession
    };
  }
});

// bookingReminders.js
var require_bookingReminders = __commonJS({
  "bookingReminders.js"(exports, module) {
    var DAY_MS = 24 * 60 * 60 * 1e3;
    var isFullFormat = (format) => ["full_v2", "full_v3", "full_v4", "full_v5", "full_v6", "full_v7"].includes(format);
    function singaporeDate(date) {
      return date.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    }
    function sessionStart(booking) {
      return /* @__PURE__ */ new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
    }
    function isReminderDue(booking, now = /* @__PURE__ */ new Date()) {
      const start = sessionStart(booking);
      return booking.status === "approved" && singaporeDate(start) === singaporeDate(new Date(now.getTime() + DAY_MS)) && start.getTime() - DAY_MS <= now.getTime();
    }
    function reminderPayload(booking, config) {
      const start = sessionStart(booking);
      if (!Number.isFinite(start.getTime())) {
        throw new Error("Invalid reminder session date/time");
      }
      const format = (date) => date.toLocaleTimeString("en-US", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).toLowerCase().replace(/\s/g, "");
      const welcome = format(start);
      const intro = format(new Date(start.getTime() + 15 * 60 * 1e3));
      return {
        messaging_product: "whatsapp",
        to: booking.customer_phone,
        type: "template",
        template: {
          name: config.template,
          language: { code: config.language },
          components: [{
            type: "body",
            parameters: [welcome, intro, intro, welcome, intro, intro].map((text) => ({ type: "text", text }))
          }]
        }
      };
    }
    function createReminderWorker({ store, send, config, now = () => /* @__PURE__ */ new Date(), logger = console }) {
      let running = false;
      return async function run() {
        if (running) return;
        running = true;
        try {
          for (let i = 0; i < 50; i++) {
            const job = await store.claim();
            if (!job) break;
            const booking = await store.getBooking(job.booking_id);
            if (!booking || !isReminderDue(booking, now()) || String(booking.session_id) !== job.session_id || booking.booking_date !== job.booking_date || booking.booking_time !== job.booking_time) {
              await store.finish(job, "skipped");
              continue;
            }
            let messageId;
            const parts = { ...job.delivery_parts || {} };
            try {
              const format = parts._format || (parts[0] ? "full_v2" : config.format);
              const payloads = isFullFormat(format) ? require_reminderTemplates().reminderSequence(booking, format) : [reminderPayload(booking, config)];
              for (const [index, payload] of payloads.entries()) {
                if (parts[index]) {
                  messageId = parts[index];
                  continue;
                }
                const response = await send(payload);
                messageId = response?.messages?.[0]?.id;
                if (!messageId) throw new Error("WhatsApp returned no message ID");
                if (isFullFormat(format)) {
                  parts[index] = messageId;
                  if (["full_v3", "full_v4", "full_v5", "full_v6", "full_v7"].includes(format)) parts._format = format;
                  await store.saveParts(job, parts);
                }
              }
            } catch (error) {
              const rejected = error.response?.status >= 400 && error.response?.status < 500 && error.response?.data?.error;
              const detail = error.response?.data?.error;
              await store.finish(
                job,
                rejected ? "failed" : "unknown",
                null,
                rejected ? typeof detail === "string" ? detail : `WhatsApp error ${detail.code}` : "Delivery outcome unknown; review before retrying"
              );
              logger.error(`Booking reminder ${job.booking_id}: ${rejected ? "rejected" : "unknown outcome"}`);
              continue;
            }
            await store.finish(job, "accepted", messageId);
          }
        } catch (error) {
          logger.error("Booking reminder worker failed:", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          });
        } finally {
          running = false;
        }
      };
    }
    function startBookingReminders() {
      if (process.env.BOOKING_REMINDERS_ENABLED !== "true") {
        console.log("Booking reminders disabled; see REMINDERS.md for setup.");
        return;
      }
      const config = {
        format: process.env.BOOKING_REMINDER_FORMAT || "full_v2",
        template: process.env.WHATSAPP_REMINDER_TEMPLATE,
        language: process.env.WHATSAPP_REMINDER_LANGUAGE || "en_US"
      };
      const { providerConfig, validateMeta, listTemplates } = require_whatsappProvider();
      const channel = providerConfig();
      if (channel.provider === "meta") validateMeta(channel);
      if (!config.template && !isFullFormat(config.format) || channel.provider === "360dialog" && !channel.apiKey) {
        throw new Error("Booking reminders require a template and WhatsApp channel credentials");
      }
      const db = require_supabaseClient();
      const { postWhatsApp } = require_whatsappSender();
      const { getBookingById } = require_bookingDatabase();
      function makeStore(table, claimRpc, getBooking) {
        return {
          async claim() {
            const { data, error } = await db.rpc(claimRpc);
            if (error) throw error;
            const job = data?.[0];
            if (!job) return null;
            if (isFullFormat(config.format)) {
              const result = await db.from(table).select("delivery_parts").eq("booking_id", job.booking_id).eq("session_id", job.session_id).eq("booking_date", job.booking_date).eq("booking_time", job.booking_time).single();
              if (result.error) throw result.error;
              job.delivery_parts = result.data.delivery_parts;
            }
            return job;
          },
          getBooking,
          async saveParts(job, parts) {
            const result = await db.from(table).update({ delivery_parts: parts, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("booking_id", job.booking_id).eq("session_id", job.session_id).eq("booking_date", job.booking_date).eq("booking_time", job.booking_time).eq("claim_token", job.claim_token).eq("status", "sending").select("booking_id");
            if (result.error) throw result.error;
            if (result.data?.length !== 1) throw new Error("Reminder claim was lost");
          },
          async finish(job, status, messageId = null, errorText = null) {
            const { data, error } = await db.from(table).update({
              status,
              whatsapp_message_id: messageId,
              last_error: errorText,
              updated_at: (/* @__PURE__ */ new Date()).toISOString(),
              next_attempt_at: status === "failed" ? new Date(Date.now() + 15 * 60 * 1e3).toISOString() : null
            }).eq("booking_id", job.booking_id).eq("session_id", job.session_id).eq("booking_date", job.booking_date).eq("booking_time", job.booking_time).eq("claim_token", job.claim_token).eq("status", "sending").select("booking_id");
            if (error) throw error;
            if (data?.length !== 1) throw new Error("Reminder claim was lost");
          }
        };
      }
      const send = async (payload) => {
        const response = await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          payload,
          { headers: {
            "D360-API-KEY": process.env.WHATSAPP_API_KEY,
            "Content-Type": "application/json"
          }, timeout: 3e4 }
        );
        return response.data;
      };
      const publicRun = createReminderWorker({ store: makeStore("booking_reminders", "claim_booking_reminder", getBookingById), config, send });
      const privateRun = createReminderWorker({ store: makeStore("staff_private_reminders", "claim_staff_private_reminder", async (id) => {
        const { data, error } = await db.from("staff_private_bookings").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        return data && data.reminder_consent && data.calendar_sync_status === "synced" ? { ...data, session_id: data.id } : null;
      }), config, send });
      let readyUntil = 0;
      const run = async () => {
        if (isFullFormat(config.format) && Date.now() >= readyUntil) {
          try {
            const rows = await listTemplates(channel, (...args) => require_axios().get(...args));
            const ready = require_reminderTemplates().getDefinitions(config.format).every((d) => rows.some((t) => t.name === d.name && t.language === d.language && String(t.status).toLowerCase() === "approved"));
            if (!ready) {
              console.log("Full reminders waiting for template approval; no jobs claimed.");
              return;
            }
            for (const table of ["booking_reminders", "staff_private_reminders"]) {
              const result = await db.from(table).select("delivery_parts").limit(0);
              if (result.error) throw result.error;
            }
            readyUntil = Date.now() + 5 * 6e4;
          } catch (error) {
            console.error("Reminder readiness check failed", error.code || "CONFIGURATION_ERROR");
            return;
          }
        }
        await publicRun();
        await privateRun();
      };
      void run();
      const timer = setInterval(() => {
        void run();
      }, 60 * 1e3);
      timer.unref();
      console.log("Booking reminder scheduler started (Singapore time).");
      return timer;
    }
    module.exports = { isReminderDue, reminderPayload, createReminderWorker, startBookingReminders };
  }
});

// reminderTestGuard.js
var require_reminderTestGuard = __commonJS({
  "reminderTestGuard.js"(exports, module) {
    var MAX_AGE_MS = 15 * 60 * 1e3;
    function reminderTestSelection(message) {
      if (message.type !== "interactive") return null;
      const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
      return typeof id === "string" && id.startsWith("REMINDER_TEST_") ? id : null;
    }
    function shouldSkipReminderTest(message, now = Date.now()) {
      if (!reminderTestSelection(message)) return false;
      const timestamp = Number(message.timestamp) * 1e3;
      return !Number.isFinite(timestamp) || timestamp <= 0 || now - timestamp > MAX_AGE_MS || timestamp - now > 30 * 1e3;
    }
    module.exports = { reminderTestSelection, shouldSkipReminderTest };
  }
});

// messageDeduplication.js
var require_messageDeduplication = __commonJS({
  "messageDeduplication.js"(exports, module) {
    var crypto = require_node_crypto();
    var supabase = require_supabaseClient();
    async function claimMessage(messageId) {
      const claimToken = crypto.randomUUID();
      const { data, error } = await supabase.rpc(
        "claim_whatsapp_message",
        {
          p_message_id: messageId,
          p_claim_token: claimToken
        }
      );
      if (error) {
        throw error;
      }
      return {
        result: data,
        claimToken
      };
    }
    async function completeMessage(messageId, claimToken) {
      const { data, error } = await supabase.rpc(
        "complete_whatsapp_message",
        {
          p_message_id: messageId,
          p_claim_token: claimToken
        }
      );
      if (error) {
        throw error;
      }
      if (data !== true) {
        throw new Error(
          `Could not complete message claim: ${messageId}`
        );
      }
    }
    async function releaseMessage(messageId, claimToken) {
      const { data, error } = await supabase.rpc(
        "release_whatsapp_message",
        {
          p_message_id: messageId,
          p_claim_token: claimToken
        }
      );
      if (error) {
        throw error;
      }
      return data;
    }
    module.exports = {
      claimMessage,
      completeMessage,
      releaseMessage
    };
  }
});

// shim:google-auth-library
import * as value5 from "npm:google-auth-library@10.5.0";
var require_google_auth_library = __commonJS({
  "shim:google-auth-library"(exports, module) {
    module.exports = value5;
  }
});

// serverless/calendar-adapter.js
var require_calendar_adapter = __commonJS({
  "serverless/calendar-adapter.js"(exports, module) {
    var { GoogleAuth } = require_google_auth_library();
    function calendar({ auth }) {
      async function request(method, args) {
        const client = await auth.getClient();
        const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`;
        const url = new URL(base + (args.eventId ? "/" + encodeURIComponent(args.eventId) : ""));
        for (const key of ["timeMin", "timeMax", "singleEvents", "orderBy", "maxResults", "pageToken"]) {
          if (args[key] !== void 0) url.searchParams.set(key, String(args[key]));
        }
        return client.request({ url: url.toString(), method, data: args.resource || args.requestBody, timeout: 2e4 });
      }
      return { events: {
        list: (args) => request("GET", args),
        get: (args) => request("GET", args),
        insert: (args) => request("POST", args),
        patch: (args) => request("PATCH", args),
        delete: (args) => request("DELETE", args)
      } };
    }
    module.exports = { google: { auth: { GoogleAuth }, calendar } };
  }
});

// calendarService.js
var require_calendarService = __commonJS({
  "calendarService.js"(exports, module) {
    var { google } = require_calendar_adapter();
    var BOOKING_CONFIG = require_bookingSchedule();
    function getSessionStart(bookingDate, bookingTime) {
      const date = String(bookingDate).slice(0, 10);
      const time = String(bookingTime).slice(0, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        throw new Error("Invalid session date or time");
      }
      const start = /* @__PURE__ */ new Date(`${date}T${time}:00+08:00`);
      if (Number.isNaN(start.getTime())) {
        throw new Error("Invalid session date or time");
      }
      return start;
    }
    function getSessionCalendarEventId(sessionId) {
      const normalizedId = String(sessionId).replace(/-/g, "").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(normalizedId)) {
        throw new Error("Invalid booking session ID");
      }
      return `booking${normalizedId}`;
    }
    var googleCredentials = process.env.GOOGLE_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) : void 0;
    if (process.env.RENDER && !googleCredentials) {
      throw new Error(
        "GOOGLE_CREDENTIALS_JSON is missing from Render environment variables"
      );
    }
    var auth = new google.auth.GoogleAuth({
      ...googleCredentials ? { credentials: googleCredentials } : { keyFile: "google-service-account.json" },
      scopes: [
        "https://www.googleapis.com/auth/calendar"
      ]
    });
    var calendar = google.calendar({
      version: "v3",
      auth
    });
    async function getUpcomingEvents() {
      const response = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: (/* @__PURE__ */ new Date()).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 20
      });
      return response.data.items || [];
    }
    async function getEventsForDay(startDate, endDate) {
      const events = [];
      let pageToken;
      do {
        const response = await calendar.events.list({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken
        });
        events.push(...response.data.items || []);
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return events;
    }
    async function getAvailableSlots(dateString) {
      const startOfDay = /* @__PURE__ */ new Date(
        `${dateString}T00:00:00+08:00`
      );
      const endOfDay = /* @__PURE__ */ new Date(
        `${dateString}T23:59:59+08:00`
      );
      const events = await getEventsForDay(
        startOfDay,
        endOfDay
      );
      const availableSlots = [];
      for (const time of BOOKING_CONFIG.startTimes) {
        const slotStart = /* @__PURE__ */ new Date(
          `${dateString}T${time}:00+08:00`
        );
        const slotEnd = new Date(
          slotStart.getTime() + BOOKING_CONFIG.durationMinutes * 6e4
        );
        const conflicts = events.some((event) => {
          if (!event.start?.dateTime || !event.end?.dateTime) {
            return false;
          }
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          return slotStart < eventEnd && slotEnd > eventStart;
        });
        if (!conflicts) {
          availableSlots.push({
            start: slotStart,
            end: slotEnd
          });
        }
      }
      return availableSlots;
    }
    async function createBookingEvent({
      customerName,
      customerPhone,
      startDateTime,
      endDateTime
    }) {
      const event = {
        summary: `Booking - ${customerName}`,
        description: `WhatsApp customer: +${customerPhone}`,
        start: {
          dateTime: startDateTime,
          timeZone: "Asia/Singapore"
        },
        end: {
          dateTime: endDateTime,
          timeZone: "Asia/Singapore"
        }
      };
      const response = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        resource: event
      });
      return response.data;
    }
    async function createSessionEvent({
      sessionId,
      bookingDate,
      bookingTime
    }) {
      const start = getSessionStart(bookingDate, bookingTime);
      const end = new Date(
        start.getTime() + BOOKING_CONFIG.durationMinutes * 6e4
      );
      const event = {
        id: getSessionCalendarEventId(sessionId),
        summary: "Tea Ceremony Booking Session",
        description: `Shared booking session
Session ID: ${sessionId}
Maximum capacity: 10 people`,
        start: {
          dateTime: start.toISOString(),
          timeZone: "Asia/Singapore"
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: "Asia/Singapore"
        },
        extendedProperties: {
          private: {
            bookingSessionId: String(sessionId)
          }
        }
      };
      try {
        const response = await calendar.events.insert({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event
        });
        return response.data;
      } catch (error) {
        const status = error.response?.status || error.code;
        if (Number(status) !== 409) {
          throw error;
        }
        const existing = await calendar.events.get({
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          eventId: event.id
        });
        if (existing.data.extendedProperties?.private?.bookingSessionId !== String(sessionId)) {
          throw new Error(
            "Calendar event ID belongs to another session"
          );
        }
        if (BOOKING_CONFIG.startTimes.includes(String(bookingTime).slice(0, 5)) && new Date(existing.data.end?.dateTime).getTime() !== end.getTime()) {
          const updated = await calendar.events.patch({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: event.id,
            requestBody: { end: event.end }
          });
          return updated.data;
        }
        return existing.data;
      }
    }
    async function hasExternalCalendarConflict({
      bookingDate,
      bookingTime,
      sessionId,
      calendarEvents
    }) {
      const start = getSessionStart(bookingDate, bookingTime);
      const end = new Date(
        start.getTime() + BOOKING_CONFIG.durationMinutes * 6e4
      );
      const events = calendarEvents || await getEventsForDay(
        /* @__PURE__ */ new Date(`${bookingDate}T00:00:00+08:00`),
        /* @__PURE__ */ new Date(`${bookingDate}T23:59:59+08:00`)
      );
      return events.some((event) => {
        if (sessionId && event.extendedProperties?.private?.bookingSessionId === String(sessionId)) {
          return false;
        }
        if (event.status === "cancelled" || event.transparency === "transparent") {
          return false;
        }
        if (event.start?.dateTime && event.end?.dateTime) {
          const eventStart = new Date(event.start.dateTime);
          const eventEnd = new Date(event.end.dateTime);
          return start < eventEnd && end > eventStart;
        }
        if (event.start?.date && event.end?.date) {
          const eventStart = /* @__PURE__ */ new Date(
            `${event.start.date}T00:00:00+08:00`
          );
          const eventEnd = /* @__PURE__ */ new Date(
            `${event.end.date}T00:00:00+08:00`
          );
          return start < eventEnd && end > eventStart;
        }
        return false;
      });
    }
    async function updateSessionEventOccupancy({
      calendarEventId,
      reservedPlaces,
      capacity
    }) {
      if (!calendarEventId) {
        throw new Error("Missing Calendar event ID");
      }
      const { data } = await calendar.events.patch({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        eventId: calendarEventId,
        requestBody: {
          summary: `Tea Ceremony \u2014 ${reservedPlaces}/${capacity} places booked`,
          description: `Places booked: ${reservedPlaces}
Places remaining: ${capacity - reservedPlaces}
Total capacity: ${capacity}`
        }
      });
      return data;
    }
    async function synchronizePrivateBooking(booking) {
      const eventId = `private${booking.id.replace(/-/g, "")}`;
      if (booking.status === "cancelled") {
        try {
          await calendar.events.delete({ calendarId: process.env.GOOGLE_CALENDAR_ID, eventId });
        } catch (error) {
          if (![404, 410].includes(Number(error.response?.status || error.code))) throw error;
        }
        return eventId;
      }
      let existing;
      try {
        existing = (await calendar.events.get({ calendarId: process.env.GOOGLE_CALENDAR_ID, eventId })).data;
      } catch (error) {
        if (Number(error.response?.status || error.code) !== 404) throw error;
      }
      const start = getSessionStart(booking.booking_date, booking.booking_time);
      if (existing) {
        if (existing.status === "cancelled" || existing.extendedProperties?.private?.privateBookingId !== booking.id || new Date(existing.start?.dateTime).getTime() !== start.getTime()) throw new Error("Private calendar event changed; review booking");
        return eventId;
      }
      if (await hasExternalCalendarConflict({ bookingDate: booking.booking_date, bookingTime: booking.booking_time }))
        throw new Error("Private session overlaps an existing calendar event");
      try {
        await calendar.events.insert({ calendarId: process.env.GOOGLE_CALENDAR_ID, resource: {
          id: eventId,
          summary: `Private Tea Session \u2014 ${booking.party_size} guests`,
          description: `Staff private booking: ${booking.id}
WhatsApp: +${booking.customer_phone}
Guests: ${booking.party_size}
Manage or cancel through the staff package desk.`,
          start: { dateTime: start.toISOString(), timeZone: "Asia/Singapore" },
          end: { dateTime: new Date(start.getTime() + 90 * 6e4).toISOString(), timeZone: "Asia/Singapore" },
          extendedProperties: { private: { privateBookingId: booking.id } }
        } });
      } catch (error) {
        if (Number(error.response?.status || error.code) !== 409) throw error;
        return synchronizePrivateBooking(booking);
      }
      return eventId;
    }
    module.exports = {
      synchronizePrivateBooking,
      getUpcomingEvents,
      getEventsForDay,
      getAvailableSlots,
      createBookingEvent,
      createSessionEvent,
      hasExternalCalendarConflict,
      updateSessionEventOccupancy
    };
  }
});

// staffHandover.js
var require_staffHandover = __commonJS({
  "staffHandover.js"(exports, module) {
    var HANDOVER_MS = 60 * 60 * 1e3;
    function createStaffHandover({ now = Date.now } = {}) {
      const quietUntil = /* @__PURE__ */ new Map();
      const phone = (value7) => String(value7 || "").replace(/[\s()+-]/g, "");
      function prune() {
        const time = now();
        for (const [customer, expiry] of quietUntil) {
          if (expiry <= time) quietUntil.delete(customer);
        }
      }
      function recordChange(change) {
        if (change.field !== "smb_message_echoes") return [];
        prune();
        const business = phone(change.value?.metadata?.display_phone_number);
        const customers = [];
        for (const message of change.value?.message_echoes || []) {
          const customer = phone(message.to);
          const timestamp = Number(message.timestamp) * 1e3;
          if (!message.id || !/^\d{7,15}$/.test(customer) || !business || phone(message.from) !== business || customer === business || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now() + 6e4) continue;
          const expiry = timestamp + HANDOVER_MS;
          if (expiry <= now()) continue;
          quietUntil.set(customer, Math.max(quietUntil.get(customer) || 0, expiry));
          customers.push(customer);
        }
        return customers;
      }
      function isActive(customer) {
        prune();
        return (quietUntil.get(phone(customer)) || 0) > now();
      }
      return { recordChange, isActive };
    }
    module.exports = { createStaffHandover, HANDOVER_MS };
  }
});

// bookingJourney.js
var require_bookingJourney = __commonJS({
  "bookingJourney.js"(exports, module) {
    function createBookingJourney({
      getDraft,
      startBooking,
      checkPackage,
      sendButtons,
      sendMessage,
      notifyStaff,
      showDates,
      showMainMenu,
      isChinese,
      ceremonyPrices,
      saveDraft = async () => {
      }
    }) {
      async function ask(from, en, zh, options, imageUrl) {
        await sendButtons(from, isChinese(from) ? zh : en, options.map(([id, en2, zh2]) => ({
          id: `JOURNEY_${id}`,
          title: isChinese(from) ? zh2 : en2
        })), imageUrl);
      }
      async function bookingType(from) {
        const draft = await getDraft(from);
        const privateEn = draft.first_visit ? "If you prefer a private session, please note that the first-session promotional price does not apply. Private sessions are priced differently, and our staff will be happy to help arrange your visit and share the pricing with you." : "If you prefer a private session, please note that membership packages do not apply. Private sessions are priced differently, and our staff will be happy to help arrange your visit and share the pricing with you.";
        const privateZh = draft.first_visit ? "\u82E5\u60A8\u5E0C\u671B\u9884\u7EA6\u79C1\u4EBA\u573A\u6B21\uFF0C\u6E29\u99A8\u63D0\u9192\u60A8\uFF1A\u9996\u6B21\u4F53\u9A8C\u4F18\u60E0\u4EF7\u4E0D\u9002\u7528\u4E8E\u79C1\u4EBA\u9884\u7EA6\u3002\u79C1\u4EBA\u573A\u6B21\u6536\u8D39\u6709\u6240\u4E0D\u540C\uFF0C\u9700\u8981\u7531\u5DE5\u4F5C\u4EBA\u5458\u534F\u52A9\u5B89\u6392\u3002\u6211\u4EEC\u5F88\u4E50\u610F\u4E3A\u60A8\u4ECB\u7ECD\u4EF7\u683C\u5E76\u5B89\u6392\u5230\u8BBF\u3002" : "\u82E5\u60A8\u5E0C\u671B\u9884\u7EA6\u79C1\u4EBA\u573A\u6B21\uFF0C\u6E29\u99A8\u63D0\u9192\u60A8\uFF1A\u4F1A\u5458\u914D\u5957\u4E0D\u9002\u7528\u4E8E\u79C1\u4EBA\u9884\u7EA6\u3002\u79C1\u4EBA\u573A\u6B21\u6536\u8D39\u6709\u6240\u4E0D\u540C\uFF0C\u9700\u8981\u7531\u5DE5\u4F5C\u4EBA\u5458\u534F\u52A9\u5B89\u6392\u3002\u6211\u4EEC\u5F88\u4E50\u610F\u4E3A\u60A8\u4ECB\u7ECD\u4EF7\u683C\u5E76\u5B89\u6392\u5230\u8BBF\u3002";
        await ask(
          from,
          "Would you prefer a public or private session?\n\n" + (draft.first_visit ? "For First time visitors, you may enjoy a discounted promotion price.\n\nPromotion $68 Public session\nWeekdays (Mon-Thu): $68 (usual price $128)\nWeekends (Fri-Sun): $88 (usual price $148)\n\n" : "") + privateEn,
          "\u60A8\u5E0C\u671B\u53C2\u52A0\u516C\u4F17\u573A\u6B21\u8FD8\u662F\u79C1\u4EBA\u573A\u6B21\uFF1F\n\n" + (draft.first_visit ? "\u9996\u6B21\u5230\u8BBF\u7684\u8336\u53CB\u53EF\u4EAB\u4F18\u60E0\u4F53\u9A8C\u4EF7\u3002\n\n\u9996\u6B21\u4F53\u9A8C\u516C\u4F17\u573A\u6B21\uFF1A\n\u5E73\u65E5\uFF08\u5468\u4E00\u81F3\u5468\u56DB\uFF09\uFF1A$68\uFF08\u539F\u4EF7$128\uFF09\n\u5468\u672B\uFF08\u5468\u4E94\u81F3\u5468\u65E5\uFF09\uFF1A$88\uFF08\u539F\u4EF7$148\uFF09\n\n" : "") + privateZh,
          [
            ["PUBLIC", draft.first_visit ? "Promo $68 Public" : "Public session", draft.first_visit ? "\u9996\u6B21\u4F53\u9A8C\u516C\u4F17\u573A\u6B21" : "\u516C\u4F17\u573A\u6B21"],
            ["PRIVATE", "Private session", "\u79C1\u4EBA\u573A\u6B21"]
          ]
        );
      }
      async function purchase(from) {
        await ask(from, "Would you like to purchase a package?\n\nIf you prefer not to purchase a package, our staff will be happy to help arrange a private session. Membership packages do not apply to private bookings, and pricing is different.", "\u60A8\u60F3\u8D2D\u4E70\u914D\u5957\u5417\uFF1F\n\n\u82E5\u60A8\u6682\u65F6\u4E0D\u60F3\u8D2D\u4E70\u914D\u5957\uFF0C\u6211\u4EEC\u7684\u5DE5\u4F5C\u4EBA\u5458\u5F88\u4E50\u610F\u534F\u52A9\u60A8\u5B89\u6392\u79C1\u4EBA\u573A\u6B21\u3002\u4F1A\u5458\u914D\u5957\u4E0D\u9002\u7528\u4E8E\u79C1\u4EBA\u9884\u7EA6\uFF0C\u6536\u8D39\u4E5F\u6709\u6240\u4E0D\u540C\u3002", [
          ["BUY", "Yes, contact staff", "\u662F\uFF0C\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458"],
          ["NO_BUY", "No, private booking", "\u5426\uFF0C\u9884\u7EA6\u79C1\u4EBA\u573A\u6B21"]
        ], ceremonyPrices);
      }
      async function select(from, choice) {
        let draft = await getDraft(from);
        if (choice === "RESTART") return begin(from);
        if (!draft) return begin(from);
        if (choice === "FIRST" && draft.journey_step === "first") {
          draft.first_visit = true;
          draft.journey_step = "type";
          await saveDraft(draft);
          return bookingType(from);
        }
        if (choice === "RETURNING" && draft.journey_step === "first") {
          draft.first_visit = false;
          draft.journey_step = "package";
          await saveDraft(draft);
          return ask(from, "Have you purchased a package with us?", "\u60A8\u66FE\u5411\u6211\u4EEC\u8D2D\u4E70\u914D\u5957\u5417\uFF1F", [
            ["HAS_PACKAGE", "Yes", "\u662F"],
            ["NO_PACKAGE", "No", "\u5426"]
          ]);
        }
        if (["HAS_PACKAGE", "NO_PACKAGE"].includes(choice) && draft.journey_step === "package") {
          if (choice === "HAS_PACKAGE") {
            let verified;
            try {
              verified = await checkPackage(from);
            } catch {
              await notifyStaff(from, "Please verify this customer's package; automatic verification is unavailable.");
              return sendMessage(from, isChinese(from) ? "\u5DE5\u4F5C\u4EBA\u5458\u5C06\u6838\u5B9E\u60A8\u7684\u914D\u5957\uFF0C\u8BF7\u7B49\u5F85\u56DE\u590D\u3002" : "Staff will verify your package. Please wait for their reply.");
            }
            if (verified) {
              draft.package_verified = true;
              draft.package_routes = verified.allowed_routes;
              draft.journey_step = "type";
              await saveDraft(draft);
              return bookingType(from);
            }
            draft.package_verified = false;
            draft.package_routes = [];
            await sendMessage(from, isChinese(from) ? "\u6682\u65F6\u672A\u627E\u5230\u53EF\u4F7F\u7528\u7684\u914D\u5957\uFF0C\u60A8\u7684\u914D\u5957\u53EF\u80FD\u5DF2\u5230\u671F\u6216\u6B21\u6570\u5DF2\u7528\u5B8C\u3002\u5982\u9700\u534F\u52A9\uFF0C\u6211\u4EEC\u7684\u5DE5\u4F5C\u4EBA\u5458\u5F88\u4E50\u610F\u4E3A\u60A8\u6838\u5B9E\u3002\u60A8\u4E5F\u53EF\u4EE5\u8D2D\u4E70\u65B0\u7684\u914D\u5957\u3002" : "We couldn't find a package available to use at the moment. It may have expired or have no visits left. Our staff will be happy to help check this for you, or you can purchase a new package.");
          }
          draft.journey_step = "purchase";
          await saveDraft(draft);
          return purchase(from);
        }
        if (choice === "PRIVATE" && ["type", "purchase"].includes(draft.journey_step)) {
          await notifyStaff(from, "Customer requests a private tea session.");
          draft.journey_step = "staff";
          await saveDraft(draft);
          return sendMessage(from, isChinese(from) ? "\u611F\u8C22\u60A8\u7684\u5173\u6CE8\uFF0C\u5DE5\u4F5C\u4EBA\u5458\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\uFF0C\u534F\u52A9\u5B89\u6392\u60A8\u7684\u79C1\u4EBA\u573A\u6B21\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "Thank you for your interest, a Staff member will reply as soon as possible to help arrange your private session.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time.");
        }
        if (choice === "PUBLIC" && draft.journey_step === "type") {
          if (draft.first_visit) {
            draft.booking_route = "first_public";
            draft.journey_step = "dates";
            await saveDraft(draft);
            return showDates(from);
          }
          if (draft.package_verified) {
            draft.journey_step = "category";
            await saveDraft(draft);
            return ask(
              from,
              "Choose your public session category. Session times: 12:00pm to 1:30pm, 2:00pm to 3:30pm, 4:00pm to 5:30pm.",
              "\u8BF7\u9009\u62E9\u516C\u4F17\u573A\u6B21\u7C7B\u522B\u3002\u573A\u6B21\u65F6\u95F4\uFF1A12:00pm to 1:30pm\u30012:00pm to 3:30pm\u30014:00pm to 5:30pm\u3002",
              [
                ["WEEKDAY", "Weekday (Mon\u2013Thu)", "\u5E73\u65E5\uFF08\u5468\u4E00\u81F3\u5468\u56DB\uFF09"],
                ["WEEKEND", "Weekend (Fri\u2013Sun)", "\u5468\u672B\uFF08\u5468\u4E94\u81F3\u5468\u65E5\uFF09"],
                ["EXCLUSIVE", "Exclusive", "\u4E13\u4EAB"],
                ["PREMIUM", "Premium", "\u9AD8\u7EA7"],
                ["UNLIMITED", "Unlimited (Mon\u2013Sun)", "\u65E0\u9650\u6B21\uFF08\u5468\u4E00\u81F3\u5468\u65E5\uFF09"]
              ].filter(([id]) => draft.package_routes.includes(id.toLowerCase()))
            );
          }
        }
        if (["WEEKDAY", "WEEKEND", "EXCLUSIVE", "PREMIUM", "UNLIMITED"].includes(choice) && draft.journey_step === "category" && draft.package_verified && draft.package_routes.includes(choice.toLowerCase())) {
          draft.booking_route = choice.toLowerCase();
          draft.journey_step = "dates";
          await saveDraft(draft);
          return showDates(from);
        }
        if (choice === "BUY" && draft.journey_step === "purchase") {
          await notifyStaff(from, "Customer wants to purchase a package.");
          draft.journey_step = "staff";
          await saveDraft(draft);
          await sendMessage(from, isChinese(from) ? "\u5DE5\u4F5C\u4EBA\u5458\u4F1A\u534F\u52A9\u60A8\u8D2D\u4E70\u914D\u5957\u3002\u8D2D\u4E70\u5B8C\u6210\u540E\uFF0C\u8BF7\u4ECE\u4E3B\u83DC\u5355\u91CD\u65B0\u9884\u7EA6\u3002" : "Staff will help you purchase a package. Once complete, return to the main menu to book.");
          return;
        }
        if (choice === "NO_BUY" && draft.journey_step === "purchase") {
          await notifyStaff(from, "Customer declined to purchase a package and requests a private tea session. Please assist with arrangements and pricing.");
          draft.journey_step = "staff";
          await saveDraft(draft);
          return sendMessage(from, isChinese(from) ? "\u611F\u8C22\u60A8\u7684\u5173\u6CE8\uFF0C\u5DE5\u4F5C\u4EBA\u5458\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\uFF0C\u534F\u52A9\u5B89\u6392\u60A8\u7684\u79C1\u4EBA\u573A\u6B21\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "Thank you for your interest, a Staff member will reply as soon as possible to help arrange your private session.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time.");
        }
        return begin(from);
      }
      async function begin(from) {
        const draft = await startBooking(from);
        draft.journey_step = "first";
        await saveDraft(draft);
        await ask(from, "Is this your first time with us?", "\u8FD9\u662F\u60A8\u7B2C\u4E00\u6B21\u5230\u8BBF\u5417\uFF1F", [
          ["FIRST", "Yes, first visit", "\u662F\uFF0C\u9996\u6B21\u5230\u8BBF"],
          ["RETURNING", "No, returning guest", "\u5426\uFF0C\u518D\u6B21\u5230\u8BBF"]
        ]);
      }
      return { begin, select };
    }
    module.exports = { createBookingJourney };
  }
});

// packageService.js
var require_packageService = __commonJS({
  "packageService.js"(exports, module) {
    var supabase = require_supabaseClient();
    async function getActivePackage(customerPhone, now = /* @__PURE__ */ new Date()) {
      const { data, error } = await supabase.from("customer_packages").select("id, package_type, allowed_routes, expires_on, total_uses, used_uses").eq("customer_phone", customerPhone).eq("active", true);
      if (error) throw error;
      const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
      const packages = (data || []).filter((row) => (!row.expires_on || row.expires_on >= today) && (row.package_type === "unlimited" && row.total_uses === null || Number.isInteger(row.total_uses) && Number.isInteger(row.used_uses) && row.used_uses < row.total_uses));
      const allowedRoutes = [...new Set(packages.flatMap((row) => row.package_type === "unlimited" ? ["unlimited"] : row.allowed_routes || []))].filter((route) => ["weekday", "weekend", "exclusive", "premium", "unlimited"].includes(route));
      return allowedRoutes.length ? { allowed_routes: allowedRoutes, packages } : null;
    }
    module.exports = { getActivePackage };
  }
});

// bookingCompletion.js
var require_bookingCompletion = __commonJS({
  "bookingCompletion.js"(exports, module) {
    function createCompletionWorker({ store, synchronize, sendCustomer, sendStaff }) {
      let running = false;
      return async function run(requestId = null) {
        running = true;
        try {
          for (let i = 0; i < 30; i++) {
            const job = await store.claim(requestId);
            if (!job) break;
            try {
              const booking = await store.getBooking(job.booking_id);
              if (!booking || booking.status !== "approved") {
                await store.finish(job, "done", "done");
                continue;
              }
              if (job.stage === "calendar") await synchronize(booking);
              else if (job.stage === "customer") await sendCustomer(job, booking);
              else if (job.stage === "staff") await sendStaff(job, booking);
              if (job.stage === "calendar") await store.finish(job, "customer", "pending");
              else await advance(job, "done");
            } catch (error) {
              const rejected = error.response?.status >= 400 && error.response?.status < 500;
              if (job.stage === "calendar") await store.finish(job, job.stage, "pending", error.message);
              else await advance(job, rejected ? "pending" : "unknown", error.message);
            }
          }
        } finally {
          running = false;
        }
      };
      async function advance(job, result, errorText = null) {
        const outcomes = {
          customer_status: job.customer_status || "pending",
          staff_status: job.staff_status || "pending",
          [job.stage + "_status"]: result
        };
        const other = job.stage === "customer" ? "staff" : "customer";
        const next = outcomes[other + "_status"] === "pending" ? other : result === "pending" ? job.stage : "done";
        const status = next !== "done" ? "pending" : Object.values(outcomes).includes("unknown") ? "unknown" : "done";
        await store.finish(job, next, status, errorText, outcomes);
      }
    }
    function createSupabaseCompletionStore(db, getBooking) {
      return {
        getBooking,
        async claim(requestId) {
          const { data, error } = await db.rpc("claim_booking_completion", { p_request_id: requestId });
          if (error) throw error;
          return data?.[0] || null;
        },
        async finish(job, stage, status, errorText = null, outcomes = {}) {
          const { data, error } = await db.from("booking_completion_jobs").update({
            stage,
            status,
            ...outcomes,
            last_error: errorText || (Object.values(outcomes).includes("unknown") ? job.last_error : null),
            next_attempt_at: new Date(Date.now() + (errorText ? 6e4 : 0)).toISOString(),
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("request_id", job.request_id).eq("claim_token", job.claim_token).eq("status", "sending").select("request_id");
          if (error) throw error;
          if (data?.length !== 1) throw new Error("Booking completion claim was lost");
        }
      };
    }
    module.exports = { createCompletionWorker, createSupabaseCompletionStore };
  }
});

// node-shim:node:path
import * as value6 from "node:path";
var require_node_path = __commonJS({
  "node-shim:node:path"(exports, module) {
    module.exports = value6;
  }
});

// server.js
var require_server = __commonJS({
  "server.js"(exports, module) {
    require_dotenv().config();
    var express = require_express();
    var axios = require_axios();
    var { createDateFlowMessage, readDateFlowReply } = require_bookingDateFlow();
    var BOOKING_CONFIG = require_bookingSchedule();
    var { postWhatsApp, createWhatsAppSender } = require_whatsappSender();
    var { providerConfig, validateMeta, messageRequest } = require_whatsappProvider();
    var { metaAuthentication, mountMetaTestWebhook } = require_metaWebhook();
    var activeWhatsApp = providerConfig();
    if (activeWhatsApp.provider === "meta") validateMeta(activeWhatsApp);
    if (activeWhatsApp.provider === "meta" && !process.env.META_APP_SECRET) {
      throw new Error("META_APP_SECRET is required for direct Meta webhooks");
    }
    var { startBookingReminders, reminderPayload } = require_bookingReminders();
    var { reminderTestSelection, shouldSkipReminderTest } = require_reminderTestGuard();
    var {
      claimMessage,
      completeMessage,
      releaseMessage
    } = require_messageDeduplication();
    var {
      getUpcomingEvents,
      getEventsForDay,
      getAvailableSlots,
      createBookingEvent,
      createSessionEvent,
      hasExternalCalendarConflict,
      updateSessionEventOccupancy
    } = require_calendarService();
    var userLanguages = {};
    var app = express();
    var pendingQuestions = {};
    var { createStaffHandover } = require_staffHandover();
    var staffHandover = { isActive: () => (require_context().getStore()?.state?.handover_until || 0) > Date.now() };
    var interactionHandlers = {
      LANG_EN: handleEnglishLanguage,
      LANG_ZH: handleChineseLanguage,
      // Main Menu
      FAQ: handleFAQ,
      DIRECTIONS: handleDirections,
      THINGS_TO_NOTE: handleThingsToNote,
      BOOKING: handleBooking,
      CONTACT: handleContact,
      CANCELLATION_POLICY: handleCancellationPolicy,
      BOOK_CONFIRM: handleBookingConfirm,
      BOOK_CANCEL: handleBookingCancel,
      // FAQ
      FAQ_EXPECT: handleFAQ,
      FAQ_DURATION: handleFAQ,
      FAQ_BEGINNER: handleFAQ,
      FAQ_BRING: handleFAQ,
      FAQ_WEAR: handleFAQ,
      FAQ_CHILDREN: handleFAQ,
      FAQ_CAFFEINE: handleFAQ,
      FAQ_CHANGE: handleFAQ,
      FAQ_LATE: handleFAQ,
      // Navigation
      BACK_FAQ: handleFAQ,
      MAIN_MENU: handleMainMenu,
      // Question handling
      QUESTION_FAQ: handleFAQ,
      QUESTION_STAFF: handleQuestionStaff
    };
    var images = {
      mainMenuBanner: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/MainMenuBanner.jpg",
      teaCeremony: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/TeaCeremonyIntro.jpg",
      ceremonyPrices: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/CeremonyPrices.jpg",
      faqEnglish: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/FAQ.pdf?v=20261109",
      faqChinese: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/FAQChinese.pdf?v=20261109",
      directionsPDF: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/Getting%20to%20the%20RROYCE%20Building.pdf.pdf",
      introductionVideo: "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/IntroductionVideoWhatsApp.mp4"
    };
    var {
      getDraft,
      saveDraft,
      startBooking,
      saveBookingDate,
      saveBookingTime,
      savePartySize,
      submitBooking,
      cancelDraft,
      getBookingById,
      rejectBooking,
      getSessionAvailability,
      getSessionAvailabilityRange,
      markSessionCalendarSynced,
      getBookingSession
    } = require_bookingDatabase();
    var crypto = require_node_crypto();
    var { createBookingJourney } = require_bookingJourney();
    var { getActivePackage } = require_packageService();
    var bookingJourney = createBookingJourney({
      getDraft,
      startBooking: async (from) => {
        const draft = await startBooking(from);
        draft.language = getLanguage(from);
        return saveDraft(draft);
      },
      saveDraft,
      checkPackage: getActivePackage,
      sendButtons: sendBookingJourneyButtons,
      sendMessage,
      notifyStaff,
      showDates: sendAvailableDates,
      showMainMenu: sendMainMenu,
      ceremonyPrices: images.ceremonyPrices,
      isChinese: (from) => getLanguage(from) === "zh"
    });
    var { createCompletionWorker, createSupabaseCompletionStore } = require_bookingCompletion();
    var completeBookings = createCompletionWorker({
      store: createSupabaseCompletionStore(require_supabaseClient(), getBookingById),
      synchronize: async (booking) => {
        const event = await createSessionEvent({ sessionId: booking.session_id, bookingDate: booking.booking_date, bookingTime: booking.booking_time });
        await markSessionCalendarSynced(booking.session_id, event.id);
        const session = await getBookingSession(booking.session_id);
        await updateSessionEventOccupancy({ calendarEventId: event.id, reservedPlaces: session.reserved_places, capacity: session.capacity });
      },
      sendCustomer: async (job, booking) => {
        const chinese = job.language === "zh";
        await sendMessage(job.customer_phone, chinese ? `\u60A8\u7684\u9884\u7EA6\u5DF2\u786E\u8BA4\uFF01

\u65E5\u671F\uFF1A${booking.booking_date}
\u65F6\u95F4\uFF1A${BOOKING_CONFIG.formatSessionHours(booking.booking_time, true)}
\u4EBA\u6570\uFF1A${booking.party_size} \u4F4D` : `Your booking is confirmed!

Date: ${booking.booking_date}
Time: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, false)}
Group size: ${booking.party_size}`);
      },
      sendStaff: async (job, booking) => {
        await sendConfirmedBookingToStaff(job.customer_phone, booking, job.route);
      }
    });
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function getLanguage(from) {
      return userLanguages[from] || "en";
    }
    app.use(express.json({
      verify: (req, res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      }
    }));
    var metaTestSender = createWhatsAppSender({ post: (...request) => axios.post(...request) });
    mountMetaTestWebhook(app, {
      send: (payload) => metaTestSender(...messageRequest(providerConfig(process.env, { test: true }), payload))
    });
    var PORT = process.env.PORT || 3e3;
    var SITE = {
      businessName: "[YOUR BUSINESS NAME]",
      contactEmail: "[YOUR CONTACT EMAIL]",
      location: "[YOUR CITY, COUNTRY]"
    };
    app.get("/", (req, res) => {
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${SITE.businessName} - WhatsApp Booking Assistant</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #222; }
        h1, h2 { margin-top: 32px; }
        footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 14px; color: #555; }
    </style>
</head>
<body>
    <h1>WhatsApp Booking Assistant</h1>
    <p>${SITE.businessName} provides an automated WhatsApp assistant for small businesses. It answers customers' common questions and takes bookings through WhatsApp, at any time of day.</p>

    <h2>How it works</h2>
    <ol>
        <li>A customer sends a message to the business's WhatsApp number.</li>
        <li>The assistant replies with a menu and answers common questions about the business.</li>
        <li>To book, the customer chooses a date, a time and the number of guests.</li>
        <li>The booking is confirmed in the chat and added to the business's calendar.</li>
        <li>If the assistant cannot answer something, the message is passed to the business's staff to follow up.</li>
    </ol>

    <h2>Who uses it</h2>
    <p>Businesses that take bookings, such as tea ceremony sessions, workshops and tours, use the assistant so that staff do not need to reply to every message, and can see all bookings in one calendar.</p>

    <h2>Your data</h2>
    <p>We use the customer's WhatsApp phone number and messages only to reply, manage the booking and pass questions to staff. We do not sell this data or use it for advertising. See our <a href="/privacy">Privacy Policy</a>.</p>

    <h2>Contact</h2>
    <p>${SITE.businessName}<br>${SITE.location}<br>Email: ${SITE.contactEmail}</p>

    <footer>&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} ${SITE.businessName}. <a href="/privacy">Privacy Policy</a></footer>
</body>
</html>`);
    });
    app.get("/privacy", (req, res) => {
      res.sendFile(require_node_path().join(__dirname, "privacy.html"));
    });
    app.get("/health", (req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.get("/connect-whatsapp", (req, res) => {
      res.status(200).send('<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp account connection</title></head><body><h1>WhatsApp account connection</h1><p>Account connections are currently managed by staff. Please contact your service administrator to connect a business account.</p></body></html>');
    });
    app.post("/whatsapp-signup/exchange", (req, res) => {
      res.status(501).json({ success: false, error: "Self-service account connection is not enabled. Contact your service administrator." });
    });
    function verify360DialogWebhookSecret(req) {
      const expectedSecret = process.env.D360_WEBHOOK_SECRET;
      const receivedSecret = req.get("X-Webhook-Secret");
      if (!expectedSecret) {
        console.error("D360_WEBHOOK_SECRET is not configured");
        return false;
      }
      if (typeof receivedSecret !== "string") {
        return false;
      }
      const receivedBuffer = Buffer.from(receivedSecret, "utf8");
      const expectedBuffer = Buffer.from(expectedSecret, "utf8");
      if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      );
    }
    app.get("/webhook", (req, res) => {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && typeof process.env.VERIFY_TOKEN === "string" && process.env.VERIFY_TOKEN.length > 0 && typeof challenge === "string" && token === process.env.VERIFY_TOKEN) {
        console.log("Webhook verified");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    });
    async function sendMessage(to, messageText) {
      try {
        const response = await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: {
              body: messageText
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
        console.log("Message sent successfully");
        console.log(response.data);
      } catch (error) {
        console.error(
          "Error sending message:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function sendImage(to, imageUrl, caption = "") {
      try {
        const response = await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "image",
            image: {
              link: imageUrl,
              caption
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
        console.log("Image sent successfully");
        console.log(response.data);
      } catch (error) {
        console.error(
          "Error sending image:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function sendLanguageMenu(to) {
      try {
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
              type: "button",
              body: {
                text: "Please choose your language.\n\u8BF7\u9009\u62E9\u60A8\u7684\u8BED\u8A00\u3002"
              },
              action: {
                buttons: [
                  {
                    type: "reply",
                    reply: {
                      id: "LANG_EN",
                      title: "English"
                    }
                  },
                  {
                    type: "reply",
                    reply: {
                      id: "LANG_ZH",
                      title: "\u4E2D\u6587"
                    }
                  }
                ]
              }
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
      } catch (error) {
        console.error(
          "Error sending language menu:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function handleEnglishLanguage(from) {
      userLanguages[from] = "en";
      await sendMainMenu(from);
    }
    async function handleChineseLanguage(from) {
      userLanguages[from] = "zh";
      await sendMainMenu(from);
    }
    async function sendMainMenu(to) {
      try {
        const language = userLanguages[to] || "en";
        const isChinese = language === "zh";
        await sendImage(
          to,
          images.mainMenuBanner,
          isChinese ? "\u6B22\u8FCE\u5149\u4E34\uFF01\u8BF7\u95EE\u4ECA\u5929\u6709\u4EC0\u4E48\u53EF\u4EE5\u534F\u52A9\u60A8\uFF1F\u83DC\u5355\u9009\u9879\u6B63\u5728\u52A0\u8F7D\uFF0C\u8BF7\u7A0D\u7B49\u3002" : "Welcome! How can we help you today? Please wait while the menu options load."
        );
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
              type: "list",
              body: {
                text: isChinese ? "\u8BF7\u9009\u62E9\u4E00\u4E2A\u9009\u9879\uFF1A\n\u53D1\u9001\u201Chi\u201D\u6216\u201Chello\u201D\u53EF\u8FD4\u56DE\u8BED\u8A00\u9009\u62E9\u3002\u53D1\u9001\u95EE\u9898\u4F1A\u8F6C\u7ED9\u5DE5\u4F5C\u4EBA\u5458\uFF0C\u53D1\u9001\u201CBooking\u201D\u53EF\u8FDB\u5165\u9884\u7EA6\u83DC\u5355\u3002" : "Please select an option:\nSelect Main Menu to view all options.\nSend a question to reach a staff member, \nSend \u201CBooking\u201D to open the booking menu.\nSend \u201Chi\u201D or \u201Chello\u201D to return to language selection."
              },
              action: {
                button: isChinese ? "\u4E3B\u83DC\u5355" : "Main Menu",
                sections: [
                  {
                    title: isChinese ? "\u9009\u9879" : "Options",
                    rows: [
                      {
                        id: "FAQ",
                        title: isChinese ? "\u2753 \u5E38\u89C1\u95EE\u9898" : "\u2753 FAQ"
                      },
                      {
                        id: "THINGS_TO_NOTE",
                        title: isChinese ? "\u{1F4CB} \u6CE8\u610F\u4E8B\u9879" : "\u{1F4CB} Things to Note"
                      },
                      {
                        id: "BOOKING",
                        title: isChinese ? "\u{1F4C5} \u9884\u7EA6" : "\u{1F4C5} Book a Visit"
                      },
                      {
                        id: "DIRECTIONS",
                        title: isChinese ? "\u{1F4CD} \u4EA4\u901A\u6307\u5F15" : "\u{1F4CD} Directions"
                      },
                      {
                        id: "CANCELLATION_POLICY",
                        title: isChinese ? "\u{1F4DC} \u53D6\u6D88\u4E0E\u9000\u6B3E\u653F\u7B56" : "\u{1F4DC} Cancellation & Refund"
                      },
                      {
                        id: "CONTACT",
                        title: isChinese ? "\u{1F4DE} \u8054\u7CFB\u6211\u4EEC" : "\u{1F4DE} Contact Us"
                      }
                    ]
                  }
                ]
              }
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
        console.log("Main menu sent");
      } catch (error) {
        console.error(
          "Error sending main menu:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function sendFAQDocument(to) {
      const isChinese = getLanguage(to) === "zh";
      await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: isChinese ? images.faqChinese : images.faqEnglish,
          filename: isChinese ? "Chinese \u89C2\u9890\u517B\u6027\u9759\u5FC3\u517B\u751F\u8336\u835F  Complete Bilingual Q&A.pdf" : "English \u89C2\u9890\u517B\u6027\u9759\u5FC3\u517B\u751F\u8336\u835F  Complete Bilingual Q&A.pdf"
        }
      }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
      await sendMessage(
        to,
        isChinese ? "\u5E38\u89C1\u95EE\u9898\u5DF2\u5728\u4E0A\u65B9\u6587\u4EF6\u4E2D\u89E3\u7B54\uFF0C\u8BF7\u4E0B\u8F7D\u5E76\u67E5\u770B\u3002\u5982\u6709\u6587\u4EF6\u4EE5\u5916\u7684\u5176\u4ED6\u95EE\u9898\uFF0C\u8BF7\u76F4\u63A5\u63D0\u95EE\uFF0C\u5DE5\u4F5C\u4EBA\u5458\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "Frequently asked questions are answered in this file above, kindly download and view. For any questions outside of this document, please ask and we will reply as soon as possible.\n\nOur working hours are Monday to Thursday, 12:00pm to 5:00pm Singapore Time."
      );
    }
    async function handleBooking(from) {
      await bookingJourney.begin(from);
    }
    async function sendBookingJourneyButtons(to, text, options, imageUrl) {
      await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: options.length > 3 ? { type: "list", body: { text }, action: {
          button: getLanguage(to) === "zh" ? "\u9009\u62E9\u7C7B\u522B" : "Choose category",
          sections: [{ rows: options }]
        } } : { type: "button", body: { text }, action: {
          buttons: options.map((reply) => ({ type: "reply", reply }))
        }, ...imageUrl ? { header: { type: "image", image: { link: imageUrl } } } : {} }
      }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
    }
    function getBookingDates(now = /* @__PURE__ */ new Date()) {
      const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
      const start = /* @__PURE__ */ new Date(`${today}T00:00:00Z`);
      const lastDayNextMonth = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + 4,
        0
      )).getUTCDate();
      const end = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + 3,
        Math.min(start.getUTCDate(), lastDayNextMonth)
      ));
      const dates = [];
      start.setUTCDate(start.getUTCDate() + 1);
      for (const date = new Date(start); date < end; ) {
        date.setUTCDate(date.getUTCDate() + 1);
        const value7 = date.toISOString().slice(0, 10);
        if (BOOKING_CONFIG.isBookableDate(value7)) dates.push(value7);
      }
      return dates;
    }
    async function sendAvailableDates(to, page = 0) {
      const routeDraft = await getDraft(to);
      if (routeDraft?.journey_step !== "dates" || !routeDraft.booking_route) {
        await handleBooking(to);
        return;
      }
      let dates = await getSelectableBookingDates(routeDraft.booking_route);
      if (["weekday", "weekend", "exclusive", "premium", "unlimited"].includes(routeDraft.booking_route)) {
        const membership = await getActivePackage(to);
        dates = dates.filter((date) => membership?.packages.some((pkg) => (routeDraft.booking_route === "unlimited" ? pkg.package_type === "unlimited" : pkg.allowed_routes.includes(routeDraft.booking_route)) && (!pkg.expires_on || date <= pkg.expires_on)));
      }
      if (!dates.length) {
        await sendMessage(to, getLanguage(to) === "zh" ? "\u76EE\u524D\u6CA1\u6709\u53EF\u9884\u7EA6\u65E5\u671F\uFF0C\u8BF7\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u3002" : "There are currently no bookable dates. Please contact staff.");
        return;
      }
      if (process.env.WHATSAPP_BOOKING_DATE_FLOW_ID) {
        const draft = await getDraft(to);
        if (!draft) {
          await sendMessage(to, getLanguage(to) === "zh" ? "\u9884\u7EA6\u5DF2\u5931\u6548\uFF0C\u8BF7\u53D1\u9001 Booking \u91CD\u65B0\u5F00\u59CB\u3002" : "Your booking session expired. Send Booking to start again.");
          await offerBookingRestart(to);
          return;
        }
        const payload = createDateFlowMessage({
          to,
          draft,
          dates,
          flowId: process.env.WHATSAPP_BOOKING_DATE_FLOW_ID,
          isChinese: getLanguage(to) === "zh"
        });
        await saveDraft(draft);
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          payload,
          { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } }
        );
        return;
      }
      try {
        const isChinese = getLanguage(to) === "zh";
        const pageSize = 8;
        const lastPage = Math.ceil(dates.length / pageSize) - 1;
        if (!Number.isInteger(page) || page < 0 || page > lastPage) {
          page = 0;
        }
        const rows = dates.slice(page * pageSize, (page + 1) * pageSize).map((date) => ({
          id: `BOOK_DATE_${date}`,
          title: (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).toLocaleDateString(
            isChinese ? "zh-CN" : "en-SG",
            { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }
          )
        }));
        if (page > 0) {
          rows.push({
            id: `BOOK_DATES_PAGE_${page - 1}`,
            title: isChinese ? "\u4E0A\u4E00\u9875" : "Previous dates"
          });
        }
        if (page < lastPage) {
          rows.push({
            id: `BOOK_DATES_PAGE_${page + 1}`,
            title: isChinese ? "\u4E0B\u4E00\u9875" : "Next dates"
          });
        }
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
              type: "list",
              body: {
                text: isChinese ? `\u8BF7\u9009\u62E9\u9884\u7EA6\u65E5\u671F\uFF08\u53EF\u63D0\u524D\u4E09\u4E2A\u6708\u9884\u7EA6\uFF09\u3002\u7B2C ${page + 1}/${lastPage + 1} \u9875\u3002` : `Choose a date up to three months ahead. Page ${page + 1}/${lastPage + 1}.`
              },
              action: {
                button: isChinese ? "\u9009\u62E9\u65E5\u671F" : "Choose Date",
                sections: [
                  {
                    title: isChinese ? "\u53EF\u9884\u7EA6\u65E5\u671F" : "Available Dates",
                    rows
                  }
                ]
              }
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
      } catch (error) {
        console.error(
          "Error sending available dates:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function getSelectableBookingDates(route) {
      const dates = getBookingDates().filter((date) => !route || BOOKING_CONFIG.isRouteDateAllowed(date, route));
      if (!dates.length) return [];
      const end = /* @__PURE__ */ new Date(`${dates.at(-1)}T00:00:00+08:00`);
      end.setUTCDate(end.getUTCDate() + 1);
      const [sessions, calendarEvents] = await Promise.all([
        getSessionAvailabilityRange(dates[0], dates.at(-1)),
        getEventsForDay(/* @__PURE__ */ new Date(`${dates[0]}T00:00:00+08:00`), end)
      ]);
      const selectable = [];
      for (const date of dates) {
        const slots = await getBookableSlots(date, 1, {
          sessions: sessions.filter((session) => session.booking_date === date),
          calendarEvents
        });
        if (slots.length) selectable.push(date);
      }
      return selectable;
    }
    async function getBookableSlots(date, partySize = 1, snapshot) {
      if (!getBookingDates().includes(date)) {
        return [];
      }
      const sessions = snapshot ? snapshot.sessions : await getSessionAvailability(date);
      const slots = [];
      for (const time of BOOKING_CONFIG.startTimes) {
        const session = sessions.find(
          (item) => item.booking_time.slice(0, 5) === time
        );
        const remainingPlaces = session ? session.capacity - session.reserved_places : 10;
        if (remainingPlaces < partySize) {
          continue;
        }
        const hasConflict = await hasExternalCalendarConflict({
          bookingDate: date,
          bookingTime: time,
          sessionId: session?.id,
          calendarEvents: snapshot?.calendarEvents
        });
        if (hasConflict) {
          continue;
        }
        const start = /* @__PURE__ */ new Date(
          `${date}T${time}:00+08:00`
        );
        const end = new Date(
          start.getTime() + BOOKING_CONFIG.durationMinutes * 6e4
        );
        slots.push({
          start,
          end,
          time,
          remainingPlaces,
          sessionId: session?.id || null
        });
      }
      return slots;
    }
    async function sendAvailableTimes(to, date) {
      try {
        const isChinese = getLanguage(to) === "zh";
        const slots = await getBookableSlots(date);
        if (slots.length === 0) {
          await sendMessage(
            to,
            isChinese ? "\u62B1\u6B49\uFF0C\u6B64\u65E5\u671F\u6CA1\u6709\u53EF\u9884\u7EA6\u7684\u65F6\u95F4\u3002" : "Sorry, there are no available booking times on this date."
          );
          await sendAvailableDates(to);
          return;
        }
        const rows = slots.map((slot) => {
          const formatTime = BOOKING_CONFIG.formatTime;
          const hour = slot.start.toLocaleTimeString(
            "en-GB",
            {
              timeZone: "Asia/Singapore",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            }
          );
          return {
            id: `BOOK_TIME_${hour}`,
            title: `${formatTime(slot.start)} to ${formatTime(slot.end)}`,
            description: isChinese ? `\u5269\u4F59 ${slot.remainingPlaces} \u4E2A\u540D\u989D` : `${slot.remainingPlaces} places remaining`
          };
        });
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
              type: "list",
              body: {
                text: isChinese ? `${date} \u7684\u53EF\u9884\u7EA6\u65F6\u95F4` : `Available times for ${date}`
              },
              action: {
                button: isChinese ? "\u9009\u62E9\u65F6\u95F4" : "Choose Time",
                sections: [
                  {
                    title: isChinese ? "\u53EF\u9884\u7EA6\u65F6\u95F4" : "Available Times",
                    rows
                  }
                ]
              }
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
      } catch (error) {
        console.error(
          "Error getting available times:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function sendPartySizeMenu(to) {
      const isChinese = getLanguage(to) === "zh";
      const rows = [];
      for (let size = 1; size <= 10; size++) {
        rows.push({
          id: `BOOK_SIZE_${size}`,
          title: isChinese ? `${size} \u4F4D` : `${size} ${size === 1 ? "person" : "people"}`
        });
      }
      await postWhatsApp(
        "https://waba-v2.360dialog.io/messages",
        {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "list",
            body: {
              text: isChinese ? "\u8BF7\u95EE\u6709\u591A\u5C11\u4F4D\u53C2\u52A0\uFF1F" : "How many people will attend?"
            },
            action: {
              button: isChinese ? "\u9009\u62E9\u4EBA\u6570" : "Choose group size",
              sections: [
                {
                  title: isChinese ? "\u53C2\u52A0\u4EBA\u6570" : "Group size",
                  rows
                }
              ]
            }
          }
        },
        {
          headers: {
            "D360-API-KEY": process.env.WHATSAPP_API_KEY,
            "Content-Type": "application/json"
          }
        }
      );
    }
    async function sendBookingConfirmation(to) {
      const booking = await getDraft(to);
      const isChinese = getLanguage(to) === "zh";
      if (!booking?.booking_date || !booking?.booking_time || !booking?.party_size) {
        await sendMessage(
          to,
          isChinese ? "\u9884\u7EA6\u8D44\u6599\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your booking details are incomplete. Please start again."
        );
        await offerBookingRestart(to);
        return;
      }
      await postWhatsApp(
        "https://waba-v2.360dialog.io/messages",
        {
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: {
              text: isChinese ? `\u8BF7\u786E\u8BA4\u60A8\u7684\u9884\u7EA6\u7533\u8BF7\u3002

\u65E5\u671F\uFF1A${booking.booking_date}
\u65F6\u95F4\uFF1A${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}
\u4EBA\u6570\uFF1A${booking.party_size} \u4F4D` : `Please confirm your booking request.

Date: ${booking.booking_date}
Time: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}
Group size: ${booking.party_size}`
            },
            action: {
              buttons: [
                {
                  type: "reply",
                  reply: {
                    id: "BOOK_CONFIRM",
                    title: isChinese ? "\u786E\u8BA4" : "Confirm"
                  }
                },
                {
                  type: "reply",
                  reply: {
                    id: "BOOK_CANCEL",
                    title: isChinese ? "\u53D6\u6D88" : "Cancel"
                  }
                }
              ]
            }
          }
        },
        {
          headers: {
            "D360-API-KEY": process.env.WHATSAPP_API_KEY,
            "Content-Type": "application/json"
          }
        }
      );
    }
    async function handleBookingConfirm(from) {
      const isChinese = getLanguage(from) === "zh";
      let booking = null;
      try {
        const draft = await getDraft(from);
        if (!draft || !draft.booking_date || !draft.booking_time || !draft.party_size) {
          await sendMessage(
            from,
            isChinese ? "\u627E\u4E0D\u5230\u5B8C\u6574\u7684\u9884\u7EA6\u4FE1\u606F\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your booking details are incomplete. Please start again."
          );
          await offerBookingRestart(from);
          return;
        }
        if (draft.reserved_booking_id) {
          await completeBookings(draft.package_request_id);
          return;
        }
        const sessions = await getSessionAvailability(
          draft.booking_date
        );
        const selectedTime = String(
          draft.booking_time
        ).slice(0, 5);
        const existingSession = sessions.find(
          (session) => String(session.booking_time).slice(0, 5) === selectedTime
        );
        const hasConflict = await hasExternalCalendarConflict({
          bookingDate: draft.booking_date,
          bookingTime: selectedTime,
          sessionId: existingSession?.id
        });
        if (hasConflict) {
          await sendMessage(
            from,
            isChinese ? "\u8BE5\u65F6\u6BB5\u76EE\u524D\u65E0\u6CD5\u9884\u7EA6\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6\u65F6\u95F4\u3002" : "That time is no longer available. Please choose another time."
          );
          await sendAvailableTimes(
            from,
            draft.booking_date
          );
          return;
        }
        booking = await submitBooking(from);
        if (!booking) {
          throw new Error(
            "submitBooking returned no booking"
          );
        }
        await completeBookings(draft.package_request_id);
      } catch (error) {
        console.error("Booking confirmation error:", error);
        if (error.isWhatsAppSendError) throw error;
        const errorText = error.message || "";
        if (/PACKAGE_NO_USES|Package is no longer active/.test(errorText)) {
          await sendMessage(from, isChinese ? "\u60A8\u7684\u914D\u5957\u5DF2\u65E0\u5269\u4F59\u6B21\u6570\u6216\u5DF2\u5931\u6548\uFF0C\u8BF7\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u6216\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your package has no remaining uses or is no longer active. Please contact staff or start a new booking.");
          return;
        }
        if (errorText.includes("NOT_ENOUGH_PLACES")) {
          await sendMessage(
            from,
            isChinese ? "\u8BE5\u65F6\u6BB5\u5DF2\u6CA1\u6709\u8DB3\u591F\u540D\u989D\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u65F6\u95F4\u3002" : "There are no longer enough places at that time. Please choose another time."
          );
          return;
        }
        if (errorText.includes("ALREADY_BOOKED")) {
          await sendMessage(
            from,
            isChinese ? "\u6B64\u7535\u8BDD\u53F7\u7801\u5DF2\u63D0\u4EA4\u8FC7\u8BE5\u65F6\u6BB5\u7684\u9884\u7EA6\u3002\u5982\u9700\u67E5\u8BE2\uFF0C\u8BF7\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u3002" : "This phone number already has a booking for that session. Please contact staff to check its status."
          );
          return;
        }
        console.error(
          "Booking may require reconciliation:",
          booking?.id || "Booking ID unknown"
        );
        await sendMessage(
          from,
          isChinese ? "\u6682\u65F6\u65E0\u6CD5\u6838\u5B9E\u5B8C\u6574\u7684\u9884\u7EA6\u7ED3\u679C\uFF0C\u8BF7\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u67E5\u8BE2\uFF0C\u907F\u514D\u91CD\u590D\u9884\u7EA6\u3002" : "We couldn't verify the complete booking result. Please contact staff to check before trying again."
        );
      }
    }
    async function sendConfirmedBookingToStaff(customerPhone, booking, route) {
      const packageTypes = {
        weekday: "Weekday",
        weekend: "Weekend",
        exclusive: "Exclusive",
        premium: "Premium",
        unlimited: "Unlimited",
        first_public: "None \u2014 First trial public session: weekdays (Mon-Thu) $68 (usual price $128); weekends (Fri-Sun) $88 (usual price $148)",
        no_package: "None"
      };
      await sendMessage(
        process.env.STAFF_PHONE_NUMBER,
        `Booking confirmed

Customer: +${customerPhone}
Date: ${booking.booking_date}
Time: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, false)}
Package type: ${packageTypes[route] || "Not specified"}
Number of people: ${booking.party_size}
Booking ID: ${booking.id}`
      );
    }
    async function handleReminderTest(from, bookingId) {
      const booking = await getBookingById(bookingId);
      const isChinese = getLanguage(from) === "zh";
      if (!booking || booking.customer_phone !== from || booking.status !== "approved") {
        await sendMessage(from, isChinese ? "\u627E\u4E0D\u5230\u60A8\u7684\u5DF2\u786E\u8BA4\u9884\u7EA6\u3002" : "No confirmed booking was found for you.");
        return;
      }
      if (!process.env.WHATSAPP_REMINDER_TEMPLATE && process.env.BOOKING_REMINDER_FORMAT === "legacy") {
        await sendMessage(from, isChinese ? "\u9884\u7EA6\u63D0\u9192\u6A21\u677F\u5C1A\u672A\u914D\u7F6E\uFF0C\u8BF7\u8054\u7CFB\u5DE5\u4F5C\u4EBA\u5458\u3002" : "The reminder template is not configured yet. Please contact staff.");
        return;
      }
      if (process.env.BOOKING_REMINDER_FORMAT !== "legacy") {
        for (const payload of require_reminderTemplates().reminderSequence(booking, process.env.BOOKING_REMINDER_FORMAT || "full_v2")) {
          await postWhatsApp("https://waba-v2.360dialog.io/messages", payload, {
            headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY },
            timeout: 3e4
          });
        }
        return;
      }
      await postWhatsApp("https://waba-v2.360dialog.io/messages", reminderPayload(booking, {
        template: process.env.WHATSAPP_REMINDER_TEMPLATE,
        language: process.env.WHATSAPP_REMINDER_LANGUAGE || "en_US"
      }), { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY }, timeout: 3e4 });
    }
    async function handleBookingCancel(from) {
      const isChinese = getLanguage(from) === "zh";
      await cancelDraft(from);
      await sendMessage(
        from,
        isChinese ? "\u60A8\u7684\u9884\u7EA6\u7533\u8BF7\u5DF2\u53D6\u6D88\u3002" : "Your booking request has been cancelled."
      );
      await sendMainMenu(from);
    }
    async function sendContactNavigation(to) {
      try {
        const isChinese = getLanguage(to) === "zh";
        await postWhatsApp(
          "https://waba-v2.360dialog.io/messages",
          {
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
              type: "button",
              body: {
                text: isChinese ? "\u63A5\u4E0B\u6765\u60A8\u60F3\u505A\u4EC0\u4E48\uFF1F" : "What would you like to do next?"
              },
              action: {
                buttons: [
                  {
                    type: "reply",
                    reply: {
                      id: "MAIN_MENU",
                      title: isChinese ? "\u4E3B\u83DC\u5355" : "Main Menu"
                    }
                  }
                ]
              }
            }
          },
          {
            headers: {
              "D360-API-KEY": process.env.WHATSAPP_API_KEY,
              "Content-Type": "application/json"
            }
          }
        );
      } catch (error) {
        console.error(
          "Error sending contact navigation:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
    async function notifyStaff(customerNumber, customerMessage) {
      try {
        const customerLanguage = getLanguage(customerNumber) === "zh" ? "Chinese" : "English";
        await sendMessage(
          process.env.STAFF_PHONE_NUMBER,
          `New customer message

Customer: +${customerNumber}
Language: ${customerLanguage}

Message: ${customerMessage}`
        );
        console.log(
          "Staff notified about customer:",
          customerNumber
        );
      } catch (error) {
        console.error(
          "Error notifying staff:",
          error
        );
        throw error;
      }
    }
    async function handleFAQ(from) {
      await sendFAQDocument(from);
    }
    async function handleDirections(from) {
      await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp",
        to: from,
        type: "document",
        document: {
          link: images.directionsPDF,
          filename: "Directions.pdf",
          caption: getLanguage(from) === "zh" ? "\u8BF7\u67E5\u770B\u9644\u4EF6\u4E2D\u7684\u4EA4\u901A\u6307\u5F15\u3002" : "Please see the attached directions to our tea space."
        }
      }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
    }
    async function sendIntroductionVideo(to) {
      await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp",
        to,
        type: "video",
        video: { link: images.introductionVideo, caption: getLanguage(to) === "zh" ? "\u60A8\u53EF\u4EE5\u89C2\u770B\u9644\u4E0A\u7684\u89C6\u9891\uFF0C\u5168\u9762\u4E86\u89E3\u8336\u9053\u3002" : "You can watch the attached video for a thorough introduction to Tea Ceremony" }
      }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
    }
    async function handleThingsToNote(from) {
      const isChinese = getLanguage(from) === "zh";
      const message = isChinese ? `\u6CE8\u610F\u4E8B\u9879\uFF1A

\u8BF7\u5728\u8336\u835F\u5F00\u59CB\u524D10 - 20\u5206\u949F\u62B5\u8FBE\uFF0C\u4EE5\u4FBF\u7B7E\u5230\u3001\u4F7F\u7528\u6D17\u624B\u95F4\u5E76\u5B89\u987F\u4E0B\u6765\uFF0C\u907F\u514D\u6253\u6270\u4EEA\u5F0F\u8FDB\u884C\u3002

\u8336\u835F\u8FDB\u884C\u671F\u95F4\u8BF7\u52FF\u4F7F\u7528\u624B\u673A\u3002\u8FDB\u5165\u8336\u835F\u573A\u524D\uFF0C\u6211\u4EEC\u4F1A\u8BF7\u5BBE\u5BA2\u7EDF\u4E00\u5C06\u624B\u673A\u653E\u5165\u7BEE\u5B50\u4E2D\uFF0C\u4EE5\u7EF4\u62A4\u8336\u835F\u6240\u8425\u9020\u7684\u5B81\u9759\u6C1B\u56F4\u3002` : `Things to note:

Arrive 20 minutes before the session to check in, use the restroom and settle in without interrupting the ceremony.

No phones during the session, guests will be asked to place their phones in a basket before entering the tea area, this is to preserve the calm energy that the ceremony creates.`;
      await sendMessage(from, message);
      await sendIntroductionVideo(from);
      await sleep(1500);
      await sendMainMenu(from);
    }
    async function handleCancellationPolicy(from) {
      await sendMessage(from, getLanguage(from) === "zh" ? "\u{1F4DC} \u53D6\u6D88\u4E0E\u9000\u6B3E\u653F\u7B56\n\n\u5982\u9700\u6539\u671F\uFF0C\u8BF7\u4E8E\u9884\u7EA6\u5F00\u59CB\u65F6\u95F4\u524D\u8D85\u8FC72\u5C0F\u65F6\u8054\u7CFB\u6211\u4EEC\u3002\u6211\u4EEC\u5F88\u4E50\u610F\u534F\u52A9\u5B89\u6392\uFF0C\u5177\u4F53\u89C6\u540D\u989D\u800C\u5B9A\u3002\n\n\u82E5\u5728\u9884\u7EA6\u5F00\u59CB\u524D\u4E0D\u8DB32\u5C0F\u65F6\u53D6\u6D88\u9884\u7EA6\uFF0C\u8BE5\u6B21\u9884\u7EA6\u4ECD\u4F1A\u6263\u9664\u914D\u5957\u6B21\u6570\uFF1B\u5982\u9700\u91CD\u65B0\u9884\u7EA6\uFF0C\u5C06\u53E6\u6263\u4E00\u6B21\u914D\u5957\u6B21\u6570\u3002\u611F\u8C22\u60A8\u7684\u7406\u89E3\u3002\n\n\u5982\u9700\u7533\u8BF7\u9000\u6B3E\uFF0C\u8BF7\u8054\u7CFB\u6211\u4EEC\u7684\u5DE5\u4F5C\u4EBA\u5458\u3002\n\n\u672C\u6D3B\u52A8\u6700\u7EC8\u89E3\u91CA\u6743\u5F52 \u8336\u4E4B\u76F8\u535A\u7269\u9986 \xB7 \u89C2\u9890\u517B\u6027\u8336\u7A7A\u95F4 \u6240\u6709" : "\u{1F4DC} Cancellation & Refund Policy\n\nIf you wish to reschedule, please contact us more than 2 hours before your appointment. We will be happy to help, subject to availability.\n\nFor cancellations made less than 2 hours before the appointment, the package use for that appointment will still be deducted. Rescheduling will require an additional package use. Thank you for your understanding.\n\nFor refund enquiries, please contact a member of staff.\n\nPalace Museum Singapore \xB7 Authentic Tea Essence Museum \xB7 Guanyiyangxing Wellness Tea Space reserves all rights of interpretation.");
    }
    async function offerBookingRestart(from) {
      await handleBooking(from);
    }
    async function handleContact(from) {
      const isChinese = getLanguage(from) === "zh";
      await sendMessage(
        from,
        isChinese ? "\u8BF7\u8F93\u5165\u60A8\u7684\u95EE\u9898\u3002\n\n\u60A8\u7684\u4E0B\u4E00\u6761\u6D88\u606F\u5C06\u8F6C\u53D1\u7ED9\u6211\u4EEC\u7684\u5DE5\u4F5C\u4EBA\u5458\u3002" : "Please type your question below.\n\nYour next message will be forwarded to our staff."
      );
    }
    async function handleBookingDate(from, selectionId) {
      const isChinese = getLanguage(from) === "zh";
      const date = selectionId.replace("BOOK_DATE_", "");
      if (!getBookingDates().includes(date)) {
        await sendMessage(
          from,
          isChinese ? "\u9884\u7EA6\u65E5\u671F\u65E0\u6548\u3002" : "Invalid booking date."
        );
        await offerBookingRestart(from);
        return;
      }
      const draft = await getDraft(from);
      if (!draft) {
        await sendMessage(
          from,
          isChinese ? "\u627E\u4E0D\u5230\u60A8\u7684\u9884\u7EA6\u8BB0\u5F55\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your booking session could not be found. Please start again."
        );
        await offerBookingRestart(from);
        return;
      }
      if (draft.journey_step !== "dates" || draft.reserved_booking_id) {
        await offerBookingRestart(from);
        return;
      }
      if (!BOOKING_CONFIG.isRouteDateAllowed(date, draft.booking_route)) {
        await sendMessage(from, isChinese ? "\u6B64\u65E5\u671F\u4E0D\u9002\u7528\u4E8E\u60A8\u7684\u9884\u7EA6\u7C7B\u522B\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002" : "That date is not available for your booking category. Please choose again.");
        await sendAvailableDates(from);
        return;
      }
      await saveBookingDate(from, date);
      console.log("Selected booking date:", date);
      await sendAvailableTimes(from, date);
    }
    async function handleBookingPartySize(from, selectionId) {
      const partySize = Number(
        selectionId.replace("BOOK_SIZE_", "")
      );
      const isChinese = getLanguage(from) === "zh";
      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
        await sendMessage(
          from,
          isChinese ? "\u53C2\u52A0\u4EBA\u6570\u65E0\u6548\u3002" : "Invalid group size."
        );
        return;
      }
      try {
        const draft = await getDraft(from);
        if (!draft?.booking_date || !draft?.booking_time || draft.journey_step !== "dates" || draft.reserved_booking_id || !getBookingDates().includes(draft.booking_date)) {
          await sendMessage(
            from,
            isChinese ? "\u9884\u7EA6\u8D44\u6599\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your booking session has expired. Please start again."
          );
          await offerBookingRestart(from);
          return;
        }
        const availableSlots = await getBookableSlots(
          draft.booking_date,
          partySize
        );
        const selectedTime = draft.booking_time.slice(0, 5);
        const selectedSlot = availableSlots.find(
          (slot) => slot.time === selectedTime
        );
        if (!selectedSlot) {
          await sendMessage(
            from,
            isChinese ? "\u8BE5\u65F6\u6BB5\u5DF2\u6CA1\u6709\u8DB3\u591F\u540D\u989D\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6\u65F6\u95F4\u3002" : "There are no longer enough places at that time. Please choose another time."
          );
          await offerBookingRestart(from);
          return;
        }
        await savePartySize(from, partySize);
        await sendBookingConfirmation(from);
      } catch (error) {
        console.error("Party size error:", error);
        if (error.isWhatsAppSendError) throw error;
        await sendMessage(
          from,
          isChinese ? "\u6682\u65F6\u65E0\u6CD5\u68C0\u67E5\u9884\u7EA6\u540D\u989D\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" : "We couldn't check availability right now. Please try again later."
        );
      }
    }
    async function handleBookingTime(from, selectionId) {
      const isChinese = getLanguage(from) === "zh";
      const time = selectionId.replace("BOOK_TIME_", "");
      if (!/^\d{2}:\d{2}$/.test(time)) {
        await sendMessage(
          from,
          isChinese ? "\u9884\u7EA6\u65F6\u95F4\u65E0\u6548\u3002" : "Invalid booking time."
        );
        return;
      }
      const draft = await getDraft(from);
      if (!draft?.booking_date || draft.journey_step !== "dates" || draft.reserved_booking_id || !getBookingDates().includes(draft.booking_date)) {
        await sendMessage(
          from,
          isChinese ? "\u627E\u4E0D\u5230\u60A8\u9009\u62E9\u7684\u9884\u7EA6\u65E5\u671F\uFF0C\u8BF7\u91CD\u65B0\u5F00\u59CB\u9884\u7EA6\u3002" : "Your booking date could not be found. Please start again."
        );
        await offerBookingRestart(from);
        return;
      }
      const currentSlots = await getBookableSlots(
        draft.booking_date
      );
      const selectedSlot = currentSlots.find((slot) => {
        const slotTime = slot.start.toLocaleTimeString(
          "en-GB",
          {
            timeZone: "Asia/Singapore",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }
        );
        return slotTime === time;
      });
      if (!selectedSlot) {
        await sendMessage(
          from,
          isChinese ? "\u8BE5\u65F6\u6BB5\u76EE\u524D\u65E0\u6CD5\u9884\u7EA6\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6\u65F6\u95F4\u3002" : "That time is no longer available. Please choose another."
        );
        await offerBookingRestart(from);
        return;
      }
      await saveBookingTime(from, time);
      console.log("Selected booking time:", time);
      await sendPartySizeMenu(from);
    }
    async function handleMainMenu(from) {
      await sendMainMenu(from);
    }
    async function handleQuestionStaff(from) {
      const originalQuestion = pendingQuestions[from];
      const isChinese = getLanguage(from) === "zh";
      if (originalQuestion) {
        await notifyStaff(from, originalQuestion);
        delete pendingQuestions[from];
      }
      await sendMessage(
        from,
        isChinese ? "\u5DE5\u4F5C\u4EBA\u5458\u5DF2\u6536\u5230\u901A\u77E5\uFF0C\u5E76\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "A staff member has been notified and will get back to you as soon as possible.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time."
      );
      await sendContactNavigation(from);
    }
    async function handleTextMessage(from, message) {
      const text = message.text.body.trim();
      const handoverCommand = text.toLowerCase().replace(/[.,!?:;'"()，。！？]/g, "").trim();
      const requestsChatbot = /^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|你好|您好|嗨|早上好|下午好|晚上好|booking)$/.test(handoverCommand);
      if (staffHandover.isActive(from) && !requestsChatbot) {
        await notifyStaff(from, text);
        return;
      }
      const language = getLanguage(from);
      const isChinese = language === "zh";
      if (!userLanguages[from]) {
        await sendLanguageMenu(from);
        return;
      }
      const englishGreetings = [
        "hi",
        "hello",
        "hey",
        "hiya",
        "howdy",
        "good morning",
        "good afternoon",
        "good evening"
      ];
      const chineseGreetings = [
        "\u4F60\u597D",
        "\u60A8\u597D",
        "\u55E8",
        "\u65E9\u4E0A\u597D",
        "\u4E0B\u5348\u597D",
        "\u665A\u4E0A\u597D"
      ];
      const normalizedText = text.toLowerCase().replace(/[.,!?:;'"()]/g, "").trim();
      if (normalizedText === "booking") {
        await handleBooking(from);
        return;
      }
      const englishClosingMessages = [
        "thanks",
        "thank you",
        "thankyou",
        "thx",
        "ty",
        "okay",
        "ok",
        "ok thanks",
        "okay thanks",
        "alright",
        "sure",
        "got it",
        "noted",
        "cool",
        "great",
        "perfect",
        "bye",
        "goodbye",
        "see you",
        "see ya"
      ];
      const chineseClosingMessages = [
        "\u8C22\u8C22",
        "\u8C22\u8C22\u4F60",
        "\u8C22\u8C22\u60A8",
        "\u597D\u7684",
        "\u597D",
        "\u53EF\u4EE5",
        "\u660E\u767D",
        "\u660E\u767D\u4E86",
        "\u77E5\u9053\u4E86",
        "\u6536\u5230",
        "\u6CA1\u95EE\u9898",
        "\u518D\u89C1",
        "\u62DC\u62DC"
      ];
      const containsEnglishGreeting = englishGreetings.some((greeting) => {
        const regex = new RegExp(`\\b${greeting}\\b`, "i");
        return regex.test(text);
      });
      const containsChineseGreeting = chineseGreetings.some((greeting) => {
        return text.includes(greeting);
      });
      const containsGreeting = containsEnglishGreeting || containsChineseGreeting;
      const containsQuestion = text.includes("?") || text.includes("\uFF1F");
      if (containsGreeting) {
        await sendLanguageMenu(from);
        return;
      }
      const isEnglishClosing = englishClosingMessages.includes(normalizedText);
      const isChineseClosing = chineseClosingMessages.some(
        (closing) => text.includes(closing)
      );
      if (isEnglishClosing || isChineseClosing) {
        await sendMessage(
          from,
          isChinese ? "\u4E0D\u5BA2\u6C14\uFF01\u5982\u679C\u60A8\u8FD8\u6709\u5176\u4ED6\u95EE\u9898\uFF0C\u6B22\u8FCE\u968F\u65F6\u8054\u7CFB\u6211\u4EEC\u3002" : "You're welcome! If you need anything else, just send us a message."
        );
        return;
      }
      if (containsQuestion) {
        await notifyStaff(from, text);
        await sendMessage(
          from,
          isChinese ? "\u611F\u8C22\u60A8\u7684\u95EE\u9898\u3002\u5DE5\u4F5C\u4EBA\u5458\u5DF2\u6536\u5230\u901A\u77E5\uFF0C\u5E76\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "Thanks for your question. A staff member has been notified and will get back to you as soon as possible.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time."
        );
        await sendContactNavigation(from);
        return;
      }
      await notifyStaff(from, text);
      await sendMessage(
        from,
        isChinese ? "\u611F\u8C22\u60A8\u7684\u7559\u8A00\u3002\u5DE5\u4F5C\u4EBA\u5458\u5DF2\u6536\u5230\u901A\u77E5\uFF0C\u5E76\u4F1A\u5C3D\u5FEB\u56DE\u590D\u60A8\u3002\n\n\u6211\u4EEC\u7684\u5DE5\u4F5C\u65F6\u95F4\u4E3A\u65B0\u52A0\u5761\u65F6\u95F412:00pm\u81F35:30pm\u3002" : "Thanks for your message. A staff member has been notified and will get back to you as soon as possible.\n\nOur working hours are 12:00pm to 5:30pm Singapore Time."
      );
      await sendContactNavigation(from);
    }
    async function handleInteractiveMessage(from, message) {
      if (message?.interactive?.type === "nfm_reply") {
        const draft = await getDraft(from);
        const date = readDateFlowReply(
          message.interactive.nfm_reply?.response_json,
          draft,
          getBookingDates()
        );
        if (!date) {
          await sendMessage(from, getLanguage(from) === "zh" ? "\u65E5\u671F\u9009\u62E9\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002" : "That date selection has expired. Please choose again.");
          await offerBookingRestart(from);
          return;
        }
        await handleBookingDate(from, `BOOK_DATE_${date}`);
        const updatedDraft = await getDraft(from);
        if (updatedDraft?.date_flow_token === draft.date_flow_token) {
          delete updatedDraft.date_flow_token;
          delete updatedDraft.date_flow_expires_at;
          await saveDraft(updatedDraft);
        }
        return;
      }
      let selectionId;
      if (message?.interactive?.type === "button_reply") {
        selectionId = message.interactive.button_reply?.id;
      } else if (message?.interactive?.type === "list_reply") {
        selectionId = message.interactive.list_reply?.id;
      }
      if (typeof selectionId !== "string" || !selectionId) {
        console.log("Unknown interactive message");
        return;
      }
      if (selectionId.startsWith("JOURNEY_")) {
        await bookingJourney.select(from, selectionId.slice("JOURNEY_".length));
        return;
      }
      if (selectionId.startsWith("BOOK_SIZE_")) {
        await handleBookingPartySize(from, selectionId);
        return;
      }
      if (selectionId.startsWith("BOOK_DATES_PAGE_")) {
        const page = selectionId.slice("BOOK_DATES_PAGE_".length);
        await sendAvailableDates(from, /^\d+$/.test(page) ? Number(page) : 0);
        return;
      }
      if (selectionId.startsWith("BOOK_DATE_")) {
        await handleBookingDate(from, selectionId);
        return;
      }
      if (selectionId.startsWith("BOOK_TIME_")) {
        await handleBookingTime(from, selectionId);
        return;
      }
      if (selectionId.startsWith("REMINDER_TEST_")) {
        await handleReminderTest(from, selectionId.slice("REMINDER_TEST_".length));
        return;
      }
      const handler = interactionHandlers[selectionId];
      if (handler) {
        await handler(from);
      } else {
        console.log("No handler found for:", selectionId);
      }
    }
    function requireValid360DialogSecret(req, res, next) {
      if (activeWhatsApp.provider === "meta") {
        return metaAuthentication(activeWhatsApp, { secret: process.env.META_APP_SECRET })(req, res, next);
      }
      if (!verify360DialogWebhookSecret(req)) {
        console.warn(
          "Rejected webhook: invalid or missing webhook secret"
        );
        return res.sendStatus(401);
      }
      next();
    }
    app.post(
      "/webhook",
      requireValid360DialogSecret,
      async (req, res) => {
        try {
          if (process.env.BOT_STAGING === "true") {
            const allowed = new Set(String(process.env.STAGING_RECIPIENTS || "").split(",").map((p) => p.trim()));
            const incoming = (req.body.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => c.value?.messages || []));
            if (incoming.some((m) => !allowed.has(m.from))) return res.sendStatus(403);
          }
          const entries = req.body.entry || [];
          for (const entry of entries) {
            for (const change of entry.changes || []) {
              if (change.field === "smb_message_echoes") {
                for (const customer of staffHandover.recordChange(change)) {
                  console.log("Staff handover active for customer:", customer);
                }
                continue;
              }
              const messages = change.value?.messages || [];
              for (const message of messages) {
                const messageId = message.id;
                const from = message.from;
                if (!messageId || !from) {
                  console.warn(
                    "Skipping message without ID or sender"
                  );
                  continue;
                }
                const { result, claimToken } = await claimMessage(messageId);
                if (result === "completed") {
                  console.log(
                    "Skipping completed duplicate:",
                    messageId
                  );
                  continue;
                }
                if (result === "busy") {
                  console.log(
                    "Message already being processed:",
                    messageId
                  );
                  return res.sendStatus(503);
                }
                if (result !== "claimed") {
                  throw new Error(
                    `Unexpected claim result: ${result}`
                  );
                }
                try {
                  console.log(
                    "Processing message:",
                    messageId,
                    "from:",
                    from
                  );
                  console.log("Incoming WhatsApp metadata:", {
                    id: messageId,
                    timestamp: message.timestamp,
                    receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
                    type: message.type,
                    reminderTestSelection: reminderTestSelection(message)
                  });
                  if (shouldSkipReminderTest(message)) {
                    await completeMessage(messageId, claimToken);
                    console.log("Skipped stale or invalid reminder test:", messageId);
                    continue;
                  }
                  if (!userLanguages[from]) {
                    const savedDraft = await getDraft(from);
                    if (["en", "zh"].includes(savedDraft?.language)) {
                      userLanguages[from] = savedDraft.language;
                    }
                  }
                  if (message.type === "text") {
                    await handleTextMessage(from, message);
                  } else if (message.type === "interactive") {
                    await handleInteractiveMessage(
                      from,
                      message
                    );
                  } else {
                    console.log(
                      "Unsupported message type:",
                      message.type
                    );
                  }
                  await completeMessage(
                    messageId,
                    claimToken
                  );
                  console.log(
                    "Completed message:",
                    messageId
                  );
                } catch (processingError) {
                  console.error(
                    "Message processing failed:",
                    messageId,
                    JSON.stringify({
                      code: processingError.code,
                      details: processingError.details,
                      hint: processingError.hint,
                      status: processingError.response?.status,
                      error: processingError.response?.data?.error || processingError.message
                    })
                  );
                  try {
                    await releaseMessage(
                      messageId,
                      claimToken
                    );
                  } catch (releaseError) {
                    console.error(
                      "Failed to release message claim:",
                      releaseError
                    );
                  }
                  return res.sendStatus(500);
                }
              }
            }
          }
          return res.sendStatus(200);
        } catch (error) {
          console.error("Webhook error:", error);
          return res.sendStatus(500);
        }
      }
    );
    module.exports = { async processMessage(from, message, state) {
      if (state.language) userLanguages[from] = state.language;
      else delete userLanguages[from];
      if (state.pending_question) pendingQuestions[from] = state.pending_question;
      try {
        if (shouldSkipReminderTest(message)) return;
        if (!userLanguages[from]) {
          const draft = await getDraft(from);
          if (["en", "zh"].includes(draft?.language)) userLanguages[from] = draft.language;
        }
        if (message.type === "text") await handleTextMessage(from, message);
        else if (message.type === "interactive") await handleInteractiveMessage(from, message);
      } finally {
        if (userLanguages[from]) state.language = userLanguages[from];
        if (pendingQuestions[from]) state.pending_question = pendingQuestions[from];
        else delete state.pending_question;
        delete userLanguages[from];
        delete pendingQuestions[from];
      }
    } };
  }
});

// serverless/entry.js
var require_entry = __commonJS({
  "serverless/entry.js"(exports, module) {
    var { createHandler } = require_http();
    var { createWorker } = require_worker();
    var { createStore } = require_store();
    var db = require_supabaseClient();
    var bot = require_server();
    var { createStaffHandover } = require_staffHandover();
    var store = createStore(db);
    var drain = createWorker({
      store,
      processMessage: bot.processMessage,
      async recordEcho(change, state) {
        const validated = createStaffHandover().recordChange(change);
        if (validated.length) {
          const until = Number(change.value.message_echoes[0].timestamp) * 1e3 + 60 * 6e4;
          state.handover_until = Math.max(state.handover_until || 0, until);
        }
      }
    });
    if ((process.env.WHATSAPP_PROVIDER || "360dialog") !== "360dialog") {
      throw new Error("This migration targets the existing 360dialog channel only");
    }
    var handler = createHandler({
      store,
      drain,
      waitUntil: (promise) => EdgeRuntime.waitUntil(promise),
      webhookSecret: process.env.D360_WEBHOOK_SECRET,
      workerSecret: process.env.BOT_WORKER_SECRET || process.env.D360_WEBHOOK_SECRET,
      prepare: () => db.rpc("configure_bot_worker", {
        p_url: process.env.SUPABASE_URL + "/functions/v1/whatsapp-bot/work",
        p_secret: process.env.BOT_WORKER_SECRET || process.env.D360_WEBHOOK_SECRET
      }).then(({ error }) => {
        if (error) throw error;
      }),
      enabled: process.env.BOT_SERVERLESS_ENABLED === "true"
    });
    module.exports = { fetch: handler };
  }
});
export default require_entry();
