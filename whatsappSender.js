// One queue for this 360dialog channel. All server sends must use this sender.
function createWhatsAppSender({ post, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    channelIntervalMs = 1100, recipientIntervalMs = 6500,
    maxRetries = 3, warn = console.warn }) {
    let queue = Promise.resolve();
    let channelReady = 0;
    const recipientReady = new Map();

    async function send(url, payload, config) {
        for (let attempt = 0; ; attempt++) {
            const wait = Math.max(channelReady, recipientReady.get(payload.to) || 0) - now();
            if (wait > 0) await sleep(wait);
            try {
                return await post(url, payload, config);
            } catch (error) {
                const data = error.response?.data;
                const code = data?.error?.code;
                const detail = typeof data?.error === "string" ? data.error : data?.error?.message || "";
                const limited = error.response?.status === 429 ||
                    [130429, 131056, 80007].includes(code) ||
                    /too many requests|rate limit/i.test(detail);
                // Retry only explicit rejections; timeouts can have delivered a message.
                if (!limited || attempt >= maxRetries) {
                    error.isWhatsAppSendError = true;
                    throw error;
                }
                const header = error.response?.headers?.["retry-after"];
                const seconds = Number(header);
                const retryAfter = header == null ? 0 : Number.isFinite(seconds)
                    ? seconds * 1000 : Date.parse(header) - now();
                const delay = Math.max(30000 * (2 ** attempt), retryAfter || 0);
                channelReady = now() + delay;
                warn(`360dialog rate limit: retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
            } finally {
                channelReady = Math.max(channelReady, now() + channelIntervalMs);
                // Prune expired entries so phone numbers do not accumulate indefinitely.
                for (const [to, ready] of recipientReady) {
                    if (ready <= now()) recipientReady.delete(to);
                }
                recipientReady.set(payload.to, now() + recipientIntervalMs);
            }
        }
    }

    return (url, payload, config) => {
        const result = queue.then(() => send(url, payload, config));
        queue = result.catch(() => {});
        return result;
    };
}

// Lazy singleton lets chatbot replies and reminders share the same channel queue.
let defaultSender;
function postWhatsApp(...args) {
    if (!defaultSender) {
        const axios = require("axios");
        defaultSender = createWhatsAppSender({ post: (...request) => axios.post(...request) });
    }
    return defaultSender(...args);
}

module.exports = { createWhatsAppSender, postWhatsApp };
