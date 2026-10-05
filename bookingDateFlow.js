const { randomUUID } = require("node:crypto");

function createDateFlowMessage({ to, draft, dates, flowId, isChinese, now = Date.now() }) {
    if (!draft || !dates.length || !flowId) throw new Error("Missing booking date Flow configuration");
    // Store on the current draft: starting another booking invalidates old forms.
    draft.date_flow_token = randomUUID();
    draft.date_flow_expires_at = now + 30 * 60_000;
    return {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
            type: "flow",
            body: { text: isChinese
                ? "打开日历选择预约日期，可提前三个月预约。"
                : "Open the calendar to choose a date up to three months ahead." },
            action: {
                name: "flow",
                parameters: {
                    flow_message_version: "3", flow_id: flowId,
                    flow_token: draft.date_flow_token,
                    flow_cta: isChinese ? "选择日期" : "Choose date",
                    flow_action: "navigate",
                    flow_action_payload: {
                        screen: "BOOKING_DATE",
                        data: {
                            min_date: dates[0], max_date: dates.at(-1),
                            unavailable_dates: (() => {
                                const allowed = new Set(dates);
                                const excluded = [];
                                for (const day = new Date(`${dates[0]}T00:00:00Z`);
                                    day.toISOString().slice(0, 10) <= dates.at(-1);
                                    day.setUTCDate(day.getUTCDate() + 1)) {
                                    const date = day.toISOString().slice(0, 10);
                                    if (!allowed.has(date)) excluded.push(date);
                                }
                                return excluded;
                            })(),
                            date_label: isChinese ? "预约日期" : "Booking date",
                            helper_text: isChinese ? "选择日期后，点击继续查看可预约时段。"
                                : "Choose a date, then continue to see available sessions.",
                            continue_label: isChinese ? "继续" : "Continue"
                        }
                    }
                }
            }
        }
    };
}

function readDateFlowReply(responseJson, draft, dates, now = Date.now()) {
    let reply;
    try { reply = JSON.parse(responseJson); } catch { return null; }
    if (!reply || typeof reply !== "object" || !draft?.date_flow_token ||
        reply.flow_token !== draft.date_flow_token ||
        !Number.isFinite(draft.date_flow_expires_at) || now >= draft.date_flow_expires_at ||
        typeof reply.booking_date !== "string" || !dates.includes(reply.booking_date)) {
        return null;
    }
    return reply.booking_date;
}

module.exports = { createDateFlowMessage, readDateFlowReply };
