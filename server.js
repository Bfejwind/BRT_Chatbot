require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { createDateFlowMessage, readDateFlowReply } = require("./bookingDateFlow");
const BOOKING_CONFIG = require("./bookingSchedule");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { postWhatsApp } = require("./whatsappSender");
const { startBookingReminders, reminderPayload } = require("./bookingReminders");
const {
    claimMessage,
    completeMessage,
    releaseMessage
} = require("./messageDeduplication");
const {
    getUpcomingEvents,
    getEventsForDay,
    getAvailableSlots,
    createBookingEvent,
    createSessionEvent,
    hasExternalCalendarConflict,
    updateSessionEventOccupancy
} = require("./calendarService");
const userLanguages = {};
const app = express();
const pendingQuestions = {};
const interactionHandlers = {
    LANG_EN: handleEnglishLanguage,
    LANG_ZH: handleChineseLanguage,
    // Main Menu
    FAQ: handleFAQ,
    THINGS_TO_NOTE: handleThingsToNote,
    BOOKING: handleBooking,
    CONTACT: handleContact,
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
const images = {
    mainMenuBanner:
        "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/MainMenuBanner.jpg",

    teaCeremony:
        "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/TeaCeremonyIntro.jpg",

    ceremonyPrices:
        "https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/CeremonyPrices.jpg",

};
const {
    getDraft,
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
} = require("./bookingDatabase");
const crypto = require("node:crypto");
const { createBookingJourney } = require("./bookingJourney");
const { getActivePackage } = require("./packageService");
const bookingJourney = createBookingJourney({
    getDraft, startBooking, checkPackage: getActivePackage,
    sendButtons: sendBookingJourneyButtons, sendMessage, notifyStaff,
    showDates: sendAvailableDates, showMainMenu: sendMainMenu,
    isChinese: from => getLanguage(from) === "zh"
});
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getLanguage(from) {
    return userLanguages[from] || "en";
}

app.use(express.json({
    verify: (req, res, buffer) => {
        req.rawBody = Buffer.from(buffer);
    }
}));

const PORT = process.env.PORT || 3000;

// Public landing page. Meta's app review asks for a website that shows
// the service and the business providing it. EDIT the SITE constants below.
const SITE = {
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

    <footer>&copy; ${new Date().getFullYear()} ${SITE.businessName}. <a href="/privacy">Privacy Policy</a></footer>
</body>
</html>`);
});

app.get("/privacy", (req, res) => {
    res.sendFile(require("path").join(__dirname, "privacy.html"));
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Phase 5/6: Embedded Signup landing page.
// This is the exact URL entered as the Valid OAuth Redirect URI
// and covered by the Allowed Domain in Facebook Login for Business settings.
app.get("/connect-whatsapp", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Connect WhatsApp</title>
        </head>
        <body>
            <h1>Connect your WhatsApp number</h1>
            <button id="launch-signup">Connect WhatsApp</button>
            <p id="status"></p>

            <script>
                window.fbAsyncInit = function () {
                    FB.init({
                        appId: "${process.env.FACEBOOK_APP_ID}",
                        autoLogAppEvents: true,
                        xfbml: true,
                        version: "v21.0"
                    });
                };
            </script>
            <script async defer crossorigin="anonymous"
                src="https://connect.facebook.net/en_US/sdk.js">
            </script>

            <script>
                document.getElementById("launch-signup").onclick = function () {
                    const statusEl = document.getElementById("status");
                    statusEl.textContent = "Opening WhatsApp signup...";

                    FB.login(function (response) {
                        if (response.authResponse && response.authResponse.code) {
                            statusEl.textContent = "Finishing setup...";

                            fetch("/whatsapp-signup/exchange", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    code: response.authResponse.code
                                })
                            })
                                .then(res => res.json())
                                .then(data => {
                                    statusEl.textContent = data.success
                                        ? "WhatsApp connected successfully."
                                        : "Setup failed: " + (data.error || "unknown error");
                                })
                                .catch(err => {
                                    statusEl.textContent = "Setup failed: " + err.message;
                                });
                        } else {
                            statusEl.textContent = "Signup was cancelled or did not complete.";
                        }
                    }, {
                        config_id: "${process.env.EMBEDDED_SIGNUP_CONFIG_ID}",
                        response_type: "code",
                        override_default_response_type: true,
                        extras: {
                            version: "v3",
                            setup: {},
                            featureType: "whatsapp_business_app_onboarding"
                        }
                    });
                };
            </script>
        </body>
        </html>
    `);
});

// Phase 7: Exchanges the Embedded Signup "code" for a token,
// then completes onboarding for the returned WABA/phone number.
// NOTE: this is scaffolding for Phase 7 — the actual onboarding API
// calls (registering the number, subscribing the app to the WABA)
// still need to be filled in once you reach that phase and have
// a WABA ID / phone number ID coming back from Meta to test against.
app.post("/whatsapp-signup/exchange", async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, error: "Missing code" });
    }

    try {
        const tokenResponse = await axios.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            {
                params: {
                    client_id: process.env.FACEBOOK_APP_ID,
                    client_secret: process.env.META_APP_SECRET,
                    code
                }
            }
        );

        const accessToken = tokenResponse.data.access_token;

        // TODO (Phase 7): use accessToken to call the debug_token
        // endpoint to retrieve the granular_scopes, which contain
        // the new WABA ID and phone number ID Meta just created,
        // then call the register/onboarding endpoints for that number.

        console.log("Embedded Signup token exchange succeeded.");

        res.json({ success: true });

    } catch (error) {
        console.error(
            "Embedded Signup token exchange failed:",
            error.response?.data || error.message
        );

        res.status(500).json({
            success: false,
            error: "Token exchange failed"
        });
    }
});

// NOTE: Webhooks now arrive from 360dialog, not directly from Meta.
// The HMAC "Platform Secret" signing scheme is a Partner Hub-only
// feature and isn't available on a single-channel Client Hub account.
// Instead, this checks a custom header you configure yourself when
// editing the Channel Webhook URL in the 360dialog Hub (e.g. name it
// X-Webhook-Secret, value is a random string you invent) — a plain
// shared-secret check rather than a cryptographic signature.
function verify360DialogWebhookSecret(req) {
    const expectedSecret = process.env.D360_WEBHOOK_SECRET;
    const receivedSecret = req.get("X-Webhook-Secret");

    // Fail closed if the server is not configured correctly.
    if (!expectedSecret) {
        console.error("D360_WEBHOOK_SECRET is not configured");
        return false;
    }

    if (typeof receivedSecret !== "string") {
        return false;
    }

    const receivedBuffer = Buffer.from(receivedSecret, "utf8");
    const expectedBuffer = Buffer.from(expectedSecret, "utf8");

    // timingSafeEqual requires equal-length buffers.
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

    if (
        mode === "subscribe" &&
        token === process.env.VERIFY_TOKEN
    ) {
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
                to: to,
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
                to: to,
                type: "image",
                image: {
                    link: imageUrl,
                    caption: caption
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
    }
    catch (error) {
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
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Please choose your language.\n请选择您的语言。"
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
                                    title: "中文"
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
    catch (error) {
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

        // 1. Send image first
        await sendImage(
            to,
            images.mainMenuBanner,
            isChinese
                ? "欢迎！请问今天有什么可以帮到您？"
                : "Welcome! How can we help you today?"
        );

        // The shared sender paces the menu after the banner.
        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",

                interactive: {
                    type: "list",

                    body: {
                        text: isChinese
                            ? "请选择一个选项：\n发送“hi”或“hello”可返回语言选择。发送问题会转给工作人员，发送“Booking”可进入预约菜单。"
                            : "Please select an option:\nSend “hi” or “hello” to return to language selection. Send a question to reach a staff member, or send “Booking” to open the booking menu."
                    },

                    action: {
                        button: isChinese
                            ? "主菜单"
                            : "Main Menu",

                        sections: [
                            {
                                title: isChinese
                                    ? "选项"
                                    : "Options",

                                rows: [
                                    {
                                        id: "FAQ",
                                        title: isChinese
                                            ? "❓ 常见问题"
                                            : "❓ FAQ"
                                    },
                                    {
                                        id: "THINGS_TO_NOTE",
                                        title: isChinese
                                            ? "📋 注意事项"
                                            : "📋 Things to Note"
                                    },
                                    {
                                        id: "BOOKING",
                                        title: isChinese
                                            ? "📅 预约参观"
                                            : "📅 Book a Visit"
                                    },
                                    {
                                        id: "CONTACT",
                                        title: isChinese
                                            ? "📞 联系我们"
                                            : "📞 Contact Us"
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
    }
    catch (error) {
        console.error(
            "Error sending main menu:",
            error.response?.data || error.message
        );
        throw error;
    }
}

async function sendFAQDocument(to) {
    const isChinese = getLanguage(to) === "zh";
    const filename = isChinese ? "FAQchi.pdf" : "FAQ.pdf";
    const pdf = await readFile(path.join(__dirname, "FAQ", filename));
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([pdf], { type: "application/pdf" }), filename);

    const baseUrl = "https://waba-v2.360dialog.io";
    const headers = {
        "D360-API-KEY": process.env.WHATSAPP_API_KEY
    };
    const upload = await axios.post(`${baseUrl}/media`, form, { headers });
    const mediaId = upload.data?.id;

    if (!mediaId) {
        throw new Error("FAQ PDF upload did not return a media ID");
    }

    // Let failures reach the webhook so an unsuccessful delivery can be retried.
    await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
            id: mediaId,
            filename
        }
    }, { headers });

    await sendMessage(
        to,
        isChinese
            ? "常见问题已在上方文件中解答，请下载并查看。如有文件以外的其他问题，请直接提问，工作人员会尽快回复您。"
            : "Frequently asked questions are answered in this file above, kindly download and view. For any questions outside of this document, please ask and a member of staff will reply as soon as possible"
    );
}

async function handleBooking(from) {
    await bookingJourney.begin(from);
}
async function sendBookingJourneyButtons(to, text, options) {
    await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: { type: "button", body: { text }, action: {
            buttons: options.map(reply => ({ type: "reply", reply }))
        } }
    }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
}
function getBookingDates(now = new Date()) {
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const start = new Date(`${today}T00:00:00Z`);
    const lastDayNextMonth = new Date(Date.UTC(
        start.getUTCFullYear(), start.getUTCMonth() + 4, 0
    )).getUTCDate();
    const end = new Date(Date.UTC(
        start.getUTCFullYear(), start.getUTCMonth() + 3,
        Math.min(start.getUTCDate(), lastDayNextMonth)
    ));
    const dates = [];
    for (const date = new Date(start); date < end;) {
        date.setUTCDate(date.getUTCDate() + 1);
        const value = date.toISOString().slice(0, 10);
        if (BOOKING_CONFIG.isBookableDate(value)) dates.push(value);
    }
    return dates;
}

async function sendAvailableDates(to, page = 0) {
    const routeDraft = await getDraft(to);
    if (routeDraft?.journey_step !== "dates" || !routeDraft.booking_route) {
        await handleBooking(to);
        return;
    }
    const dates = await getSelectableBookingDates(routeDraft.booking_route);
    if (!dates.length) {
        await sendMessage(to, getLanguage(to) === "zh"
            ? "目前没有可预约日期，请联系工作人员。"
            : "There are currently no bookable dates. Please contact staff.");
        return;
    }
    if (process.env.WHATSAPP_BOOKING_DATE_FLOW_ID) {
        const draft = await getDraft(to);
        if (!draft) {
            await sendMessage(to, getLanguage(to) === "zh"
                ? "预约已失效，请发送 Booking 重新开始。"
                : "Your booking session expired. Send Booking to start again.");
            return;
        }
        const payload = createDateFlowMessage({
            to, draft, dates,
            flowId: process.env.WHATSAPP_BOOKING_DATE_FLOW_ID,
            isChinese: getLanguage(to) === "zh"
        });
        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            payload,
            { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } }
        );
        return;
    }
    // Keep booking available until the calendar Flow is published and configured.
    try {
        const isChinese = getLanguage(to) === "zh";
        // Eight dates leave room for both navigation rows in a ten-row list.
        const pageSize = 8;
        const lastPage = Math.ceil(dates.length / pageSize) - 1;
        if (!Number.isInteger(page) || page < 0 || page > lastPage) {
            page = 0;
        }
        const rows = dates.slice(page * pageSize, (page + 1) * pageSize)
            .map(date => ({
                id: `BOOK_DATE_${date}`,
                title: new Date(`${date}T00:00:00Z`).toLocaleDateString(
                    isChinese ? "zh-CN" : "en-SG",
                    { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }
                )
            }));
        if (page > 0) {
            rows.push({
                id: `BOOK_DATES_PAGE_${page - 1}`,
                title: isChinese ? "上一页" : "Previous dates"
            });
        }
        if (page < lastPage) {
            rows.push({
                id: `BOOK_DATES_PAGE_${page + 1}`,
                title: isChinese ? "下一页" : "Next dates"
            });
        }

        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "list",
                    body: {
                        text: isChinese
                            ? `请选择预约日期（可提前三个月预约）。第 ${page + 1}/${lastPage + 1} 页。`
                            : `Choose a date up to three months ahead. Page ${page + 1}/${lastPage + 1}.`
                    },
                    action: {
                        button: isChinese
                            ? "选择日期"
                            : "Choose Date",

                        sections: [
                            {
                                title: isChinese
                                    ? "可预约日期"
                                    : "Available Dates",

                                rows: rows
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
    catch (error) {
        console.error(
            "Error sending available dates:",
            error.response?.data || error.message
        );
        throw error;
    }
}
async function getSelectableBookingDates(route) {
    const dates = getBookingDates().filter(date => !route || BOOKING_CONFIG.isRouteDateAllowed(date, route));
    if (!dates.length) return [];
    // Fetch the whole window once, rather than issuing hundreds of API calls.
    const end = new Date(`${dates.at(-1)}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    const [sessions, calendarEvents] = await Promise.all([
        getSessionAvailabilityRange(dates[0], dates.at(-1)),
        getEventsForDay(new Date(`${dates[0]}T00:00:00+08:00`), end)
    ]);
    const selectable = [];
    for (const date of dates) {
        const slots = await getBookableSlots(date, 1, {
            sessions: sessions.filter(session => session.booking_date === date), calendarEvents
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
            item => item.booking_time.slice(0, 5) === time
        );

        const remainingPlaces = session
            ? session.capacity - session.reserved_places
            : 10;

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

        const start = new Date(
            `${date}T${time}:00+08:00`
        );

        const end = new Date(
            start.getTime() + BOOKING_CONFIG.durationMinutes * 60_000
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
                isChinese
                    ? "抱歉，此日期没有可预约的时间。"
                    : "Sorry, there are no available booking times on this date."
            );

            await sendAvailableDates(to);
            return;
        }

        const rows = slots.map(slot => {
            const formatTime = value => value.toLocaleTimeString(
                isChinese ? "zh-CN" : "en-US",
                {
                    timeZone: "Asia/Singapore",
                    hour: "numeric",
                    minute: "2-digit"
                }
            );

            // Keep the internal time as 24-hour format
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
                title: `${formatTime(slot.start)} - ${formatTime(slot.end)}`,
                description: isChinese
                    ? `剩余 ${slot.remainingPlaces} 个名额`
                    : `${slot.remainingPlaces} places remaining`
            };
        });

        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "list",
                    body: {
                        text: isChinese
                            ? `${date} 的可预约时间`
                            : `Available times for ${date}`
                    },
                    action: {
                        button: isChinese
                            ? "选择时间"
                            : "Choose Time",

                        sections: [
                            {
                                title: isChinese
                                    ? "可预约时间"
                                    : "Available Times",

                                rows: rows
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
    catch (error) {
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
            title: isChinese
                ? `${size} 位`
                : `${size} ${size === 1 ? "person" : "people"}`
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
                    text: isChinese
                        ? "请问有多少位参加？"
                        : "How many people will attend?"
                },
                action: {
                    button: isChinese ? "选择人数" : "Choose group size",
                    sections: [
                        {
                            title: isChinese ? "参加人数" : "Group size",
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

    // Make sure the customer has selected all three details.
    if (
        !booking?.booking_date ||
        !booking?.booking_time ||
        !booking?.party_size
    ) {
        await sendMessage(
            to,
            isChinese
                ? "预约资料不完整，请重新开始预约。"
                : "Your booking details are incomplete. Please start again."
        );

        return;
    }

    await postWhatsApp(
        "https://waba-v2.360dialog.io/messages",
        {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: isChinese
                        ? `请确认您的预约申请。\n\n日期：${booking.booking_date}\n时间：${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}\n人数：${booking.party_size} 位`
                        : `Please confirm your booking request.\n\nDate: ${booking.booking_date}\nTime: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}\nGroup size: ${booking.party_size}`
                },
                action: {
                    buttons: [
                        {
                            type: "reply",
                            reply: {
                                id: "BOOK_CONFIRM",
                                title: isChinese
                                    ? "确认"
                                    : "Confirm"
                            }
                        },
                        {
                            type: "reply",
                            reply: {
                                id: "BOOK_CANCEL",
                                title: isChinese
                                    ? "取消"
                                    : "Cancel"
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
        // 1. Read the customer's selected booking details.
        const draft = await getDraft(from);

        if (
            !draft ||
            !draft.booking_date ||
            !draft.booking_time ||
            !draft.party_size
        ) {
            await sendMessage(
                from,
                isChinese
                    ? "找不到完整的预约信息，请重新开始预约。"
                    : "Your booking details are incomplete. Please start again."
            );
            return;
        }

        // 2. Find the existing session, if there is one.
        const sessions = await getSessionAvailability(
            draft.booking_date
        );

        const selectedTime = String(
            draft.booking_time
        ).slice(0, 5);

        const existingSession = sessions.find(
            session =>
                String(session.booking_time).slice(0, 5) ===
                selectedTime
        );

        // 3. Check for unrelated Google Calendar events.
        const hasConflict = await hasExternalCalendarConflict({
            bookingDate: draft.booking_date,
            bookingTime: selectedTime,
            sessionId: existingSession?.id
        });

        if (hasConflict) {
            await sendMessage(
                from,
                isChinese
                    ? "该时段目前无法预约，请选择其他时间。"
                    : "That time is no longer available. Please choose another time."
            );

            await sendAvailableTimes(
                from,
                draft.booking_date
            );

            return;
        }

        // 4. Reserve places and approve the booking in Supabase.
        // Do not call this a second time for Calendar retries.
        booking = await submitBooking(from);

        if (!booking) {
            throw new Error(
                "submitBooking returned no booking"
            );
        }

        // 5. Create or retrieve ONE shared Calendar event
        // for this session.
        const calendarEvent = await createSessionEvent({
            sessionId: booking.session_id,
            bookingDate: booking.booking_date,
            bookingTime: booking.booking_time
        });

        // 6. Record the shared event ID in Supabase.
        await markSessionCalendarSynced(
            booking.session_id,
            calendarEvent.id
        );
        
        const session = await getBookingSession(
            booking.session_id
        );

        await updateSessionEventOccupancy({
            calendarEventId: calendarEvent.id,
            reservedPlaces: session.reserved_places,
            capacity: session.capacity
        });

        // 7. Confirm only after Calendar synchronization succeeds.
        await sendMessage(
            from,
            isChinese
                ? `您的预约已确认！\n\n日期：${booking.booking_date}\n时间：${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}\n人数：${booking.party_size} 位`
                : `Your booking is confirmed!\n\nDate: ${booking.booking_date}\nTime: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, isChinese)}\nGroup size: ${booking.party_size}`
        );

        await sendReminderTestOption(from, booking.id);
    } catch (error) {
        console.error("Booking confirmation error:", error);
        if (error.isWhatsAppSendError) throw error;

        const errorText = error.message || "";

        if (errorText.includes("NOT_ENOUGH_PLACES")) {
            await sendMessage(
                from,
                isChinese
                    ? "该时段已没有足够名额，请重新选择时间。"
                    : "There are no longer enough places at that time. Please choose another time."
            );
            return;
        }

        if (errorText.includes("ALREADY_BOOKED")) {
            await sendMessage(
                from,
                isChinese
                    ? "此电话号码已提交过该时段的预约。如需查询，请联系工作人员。"
                    : "This phone number already has a booking for that session. Please contact staff to check its status."
            );
            return;
        }

        // A reservation may have succeeded even if a later
        // Calendar or WhatsApp operation failed.
        console.error(
            "Booking may require reconciliation:",
            booking?.id || "Booking ID unknown"
        );

        await sendMessage(
            from,
            isChinese
                ? "暂时无法核实完整的预约结果，请联系工作人员查询，避免重复预约。"
                : "We couldn't verify the complete booking result. Please contact staff to check before trying again."
        );
    }
}

async function sendReminderTestOption(to, bookingId) {
    const isChinese = getLanguage(to) === "zh";
    await postWhatsApp("https://waba-v2.360dialog.io/messages", {
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
            type: "button",
            body: { text: isChinese
                ? "想测试预约提醒吗？点击下方按钮即可立即收到一条测试提醒。测试消息中的“明天”仅为模板示例，您的预约日期不变。正式提醒仍会在预约前24小时发送。"
                : "Would you like to test your booking reminder? Tap below to receive a test reminder now. The test template says ‘tomorrow’ as a sample; your booked date stays the same. Your scheduled reminder will still be sent 24 hours before your booking." },
            action: { buttons: [{ type: "reply", reply: {
                id: `REMINDER_TEST_${bookingId}`,
                title: isChinese ? "测试提醒" : "Test reminder"
            } }] }
        }
    }, { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY } });
}

async function handleReminderTest(from, bookingId) {
    const booking = await getBookingById(bookingId);
    const isChinese = getLanguage(from) === "zh";
    if (!booking || booking.customer_phone !== from || booking.status !== "approved") {
        await sendMessage(from, isChinese ? "找不到您的已确认预约。" : "No confirmed booking was found for you.");
        return;
    }
    if (!process.env.WHATSAPP_REMINDER_TEMPLATE) {
        await sendMessage(from, isChinese ? "预约提醒模板尚未配置，请联系工作人员。" : "The reminder template is not configured yet. Please contact staff.");
        return;
    }
    // A customer-requested test does not claim or finish a scheduled reminder job.
    await postWhatsApp("https://waba-v2.360dialog.io/messages", reminderPayload(booking, {
        template: process.env.WHATSAPP_REMINDER_TEMPLATE,
        language: process.env.WHATSAPP_REMINDER_LANGUAGE || "en_US"
    }), { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY }, timeout: 30000 });
}

async function handleBookingCancel(from) {
    const isChinese = getLanguage(from) === "zh";

    await cancelDraft(from);

    await sendMessage(
        from,
        isChinese
            ? "您的预约申请已取消。"
            : "Your booking request has been cancelled."
    );

    await sendMainMenu(from);
}
async function sendBookingRequestToStaff(customerPhone, booking) {
    try {
        const customerLanguage =
            getLanguage(customerPhone) === "zh"
                ? "Chinese"
                : "English";

        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: process.env.STAFF_PHONE_NUMBER,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text:
                            `New Booking Request\n\n` +
                            `Customer: +${customerPhone}\n` +
                            `Language: ${customerLanguage}\n` +
                            `Date: ${booking.booking_date}\n` +
                            `Time: ${BOOKING_CONFIG.formatSessionHours(booking.booking_time, false)}\n` +
                            `Group size: ${booking.party_size}`
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: `APPROVE_${booking.id}`,
                                    title: "Approve"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: `REJECT_${booking.id}`,
                                    title: "Reject"
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
    catch (error) {
        console.error(
            "Error sending booking to staff:",
            error.response?.data || error.message
        );
        throw error;
    }
}
async function sendNavigationMenu(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        const response = await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: isChinese
                            ? "您还想了解其他内容吗？"
                            : "Would you like to see anything else?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_FAQ",
                                    title: isChinese
                                        ? "返回常见问题"
                                        : "Back to FAQ"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: isChinese
                                        ? "主菜单"
                                        : "Main Menu"
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

        console.log("Navigation menu sent successfully");
        console.log(response.data);

    } catch (error) {
        console.error(
            "Error sending navigation menu:",
            error.response?.data || error.message
        );
        throw error;
    }
}

async function sendContactNavigation(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: isChinese
                            ? "接下来您想做什么？"
                            : "What would you like to do next?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: isChinese
                                        ? "主菜单"
                                        : "Main Menu"
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

async function sendQuestionOptions(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        await postWhatsApp(
            "https://waba-v2.360dialog.io/messages",
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: isChinese
                            ? "您的问题可能已经在常见问题中得到解答。您想先查看常见问题吗？"
                            : "Your question may already be answered in our FAQ. " +
                              "Would you like to check the FAQ first?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "QUESTION_FAQ",
                                    title: isChinese
                                        ? "查看常见问题"
                                        : "Check FAQ"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "QUESTION_STAFF",
                                    title: isChinese
                                        ? "联系工作人员"
                                        : "Contact Staff"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: isChinese
                                        ? "主菜单"
                                        : "Main Menu"
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
            "Error sending question options:",
            error.response?.data || error.message
        );
        throw error;
    }
}
async function notifyStaff(customerNumber, customerMessage) {
    try {
        const customerLanguage =
            getLanguage(customerNumber) === "zh"
                ? "Chinese"
                : "English";

        await sendMessage(
            process.env.STAFF_PHONE_NUMBER,
            `New customer message\n\n` +
            `Customer: +${customerNumber}\n` +
            `Language: ${customerLanguage}\n\n` +
            `Message: ${customerMessage}`
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
//Functions
// =========================
// MAIN MENU HANDLERS
// =========================

async function handleFAQ(from) {
    await sendFAQDocument(from);
}


async function handleThingsToNote(from) {
    const isChinese = getLanguage(from) === "zh";

    const message = isChinese
        ? `注意事项：

请在茶道开始前约 5–10 分钟抵达，以便签到、使用洗手间并安顿下来，避免打扰仪式进行。

茶道进行期间请勿使用手机。进入茶道区域前，我们会请宾客将手机放入篮子中，以维护茶道所营造的宁静氛围。`
        : `Things to note:

Arrive about 5-10 mins before the session to check in, use the restroom and settle in without interrupting the ceremony.

No phones during the session, guests will be asked to place their phones in a basket before entering the tea area, this is to preserve the calm energy that the ceremony creates.`;

    await sendMessage(from, message);

    await sleep(1500);

    await sendMainMenu(from);
}

async function handleContact(from) {
    const isChinese = getLanguage(from) === "zh";
    
    await sendMessage(
        from,
        isChinese
        ? "请输入您的问题。\n\n您的下一条消息将转发给我们的工作人员。"
            : "Please type your question below.\n\nYour next message will be forwarded to our staff."
    );
}

async function handleBookingDate(from, selectionId) {
    const isChinese = getLanguage(from) === "zh";
    const date = selectionId.replace("BOOK_DATE_", "");

    if (!getBookingDates().includes(date)) {
        await sendMessage(
            from,
            isChinese ? "预约日期无效。" : "Invalid booking date."
        );
        await sendAvailableDates(from);
        return;
    }

    const draft = await getDraft(from);

    if (!draft) {
        await sendMessage(
            from,
            isChinese
                ? "找不到您的预约记录，请重新开始预约。"
                : "Your booking session could not be found. Please start again."
        );
        return;
    }

    if (draft.journey_step !== "dates" || !BOOKING_CONFIG.isRouteDateAllowed(date, draft.booking_route)) {
        await sendMessage(from, isChinese
            ? "此日期不适用于您的预约类别，请重新选择。"
            : "That date is not available for your booking category. Please choose again.");
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

    if (
        !Number.isInteger(partySize) ||
        partySize < 1 ||
        partySize > 10
    ) {
        await sendMessage(
            from,
            isChinese ? "参加人数无效。" : "Invalid group size."
        );
        return;
    }

    try {
        const draft = await getDraft(from);

        if (!draft?.booking_date || !draft?.booking_time) {
            await sendMessage(
                from,
                isChinese
                    ? "预约资料已失效，请重新开始预约。"
                    : "Your booking session has expired. Please start again."
            );
            return;
        }

        // Recheck the selected time for this specific group size.
        const availableSlots = await getBookableSlots(
            draft.booking_date,
            partySize
        );

        const selectedTime = draft.booking_time.slice(0, 5);

        const selectedSlot = availableSlots.find(
            slot => slot.time === selectedTime
        );

        if (!selectedSlot) {
            await sendMessage(
                from,
                isChinese
                    ? "该时段已没有足够名额，请选择其他时间。"
                    : "There are no longer enough places at that time. Please choose another time."
            );

            await sendAvailableTimes(from, draft.booking_date);
            return;
        }

        await savePartySize(from, partySize);
        await sendBookingConfirmation(from);

    } catch (error) {
        console.error("Party size error:", error);
        if (error.isWhatsAppSendError) throw error;

        await sendMessage(
            from,
            isChinese
                ? "暂时无法检查预约名额，请稍后再试。"
                : "We couldn't check availability right now. Please try again later."
        );
    }
}
async function handleBookingTime(from, selectionId) {
    const isChinese = getLanguage(from) === "zh";
    const time = selectionId.replace("BOOK_TIME_", "");

    if (!/^\d{2}:\d{2}$/.test(time)) {
        await sendMessage(
            from,
            isChinese ? "预约时间无效。" : "Invalid booking time."
        );
        return;
    }

    const draft = await getDraft(from);

    if (!draft?.booking_date) {
        await sendMessage(
            from,
            isChinese
                ? "找不到您选择的预约日期，请重新开始预约。"
                : "Your booking date could not be found. Please start again."
        );
        return;
    }

    // Do not trust an old WhatsApp menu.
    // Check that the selected time is still offered.
    const currentSlots = await getBookableSlots(
        draft.booking_date
    );

    const selectedSlot = currentSlots.find(slot => {
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
            isChinese
                ? "该时段目前无法预约，请选择其他时间。"
                : "That time is no longer available. Please choose another."
        );

        await sendAvailableTimes(
            from,
            draft.booking_date
        );

        return;
    }

    await saveBookingTime(from, time);

    console.log("Selected booking time:", time);

    await sendPartySizeMenu(from);
}

async function handleBookingApproval(from, selectionId) {
    if (from !== process.env.STAFF_PHONE_NUMBER) {
        return;
    }

    await sendMessage(
        from,
        "Booking approval is temporarily disabled while the " +
        "new capacity and Calendar integration is being completed."
    );
}

async function handleBookingRejection(from, selectionId) {
    if (from !== process.env.STAFF_PHONE_NUMBER) {
        return;
    }

    await sendMessage(
        from,
        "Booking rejection is temporarily disabled while the " +
        "new booking integration is being completed."
    );
}


// =========================
// FAQ HANDLERS
// =========================

async function sendFAQAnswer(from, englishQuestion, englishAnswer,
                             chineseQuestion, chineseAnswer) {
    const isChinese = getLanguage(from) === "zh";

    const message = isChinese
        ? `${chineseQuestion}\n\n${chineseAnswer}`
        : `${englishQuestion}\n\n${englishAnswer}`;

    await sendMessage(from, message);
    await sendNavigationMenu(from);
}

async function handleFAQExpect(from) {
    await sendFAQAnswer(
        from,
        "What should I expect during a tea ceremony?",
        "A tea ceremony is usually a calm, guided experience where the host prepares and serves tea while explaining the traditions, utensils, movements, and meaning behind the ceremony.",
        "茶道体验包括什么？",
        "茶道通常是一场宁静、由主持人引导的体验。主持人会准备并奉上茶，同时介绍茶道的传统、茶具、动作及其背后的意义。"
    );
}

async function handleFAQDuration(from) {
    await sendFAQAnswer(
        from,
        "How long does the tea ceremony take?",
        "The experiences last around 30 minutes",
        "茶道体验需要多长时间？",
        "体验时间约为 30 分钟。"
    );
}

async function handleFAQBeginner(from) {
    await sendFAQAnswer(
        from,
        "Do I need to know anything about tea beforehand?",
        "Not at all! Tea ceremonies are designed to be enjoyed by beginners. Your host will guide you through the experience and explain anything you need to know.",
        "需要事先了解茶知识吗？",
        "完全不需要！茶道体验也适合初学者。主持人会全程引导，并为您讲解所需了解的内容。"
    );
}

async function handleFAQBring(from) {
    await sendFAQAnswer(
        from,
        "Do I need to bring anything?",
        "We only ask that you bring an open mind with the intent to disconnect from a hectic life.",
        "需要携带什么吗？",
        "您只需要带着开放的心态前来，暂时放下忙碌的生活，享受当下。"
    );
}

async function handleFAQWear(from) {
    await sendFAQAnswer(
        from,
        "What should I wear?",
        "Loose or comfortable clothing will make the experience more enjoyable. Avoid anything that may make sitting or moving around uncomfortable.",
        "应该穿什么？",
        "宽松或舒适的衣物能让体验更加愉快。请避免穿着可能令您坐下或活动时感到不适的服装。"
    );
}

async function handleFAQChildren(from) {
    await sendFAQAnswer(
        from,
        "Can children attend?",
        "Yes.",
        "儿童可以参加吗？",
        "可以。"
    );
}

async function handleFAQCaffeine(from) {
    await sendFAQAnswer(
        from,
        "Does the tea contain caffeine?",
        "No.",
        "茶含有咖啡因吗？",
        "不含。"
    );
}

async function handleFAQChange(from) {
    await sendFAQAnswer(
        from,
        "Can I cancel or change my booking?",
        "Yes, please contact staff by sending a message to this number with your request for change.",
        "可以取消或更改预约吗？",
        "可以。请发送消息至此号码，向工作人员提出您的更改或取消预约请求。"
    );
}

async function handleFAQLate(from) {
    await sendFAQAnswer(
        from,
        "What if I am late to my booking?",
        "Please contact our staff for assistance. [REPLACE WITH YOUR ACTUAL LATENESS POLICY]",
        "如果预约迟到了怎么办？",
        "请联系工作人员寻求协助。[请替换为实际的迟到处理规定]"
    );
}

// =========================
// NAVIGATION HANDLERS
// =========================

async function handleBackFAQ(from) {
    await sendFAQDocument(from);
}

async function handleMainMenu(from) {
    await sendMainMenu(from);
}


// =========================
// QUESTION HANDLERS
// =========================

async function handleQuestionFAQ(from) {
    await sendFAQDocument(from);
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
        isChinese
        ? "工作人员已收到通知，并会尽快回复您。"
        : "A staff member has been notified and will get back to you as soon as possible."
    );
    
    await sendContactNavigation(from);
}
//Text Response Handler
async function handleTextMessage(from, message) {
    const text = message.text.body.trim();

    const language = getLanguage(from);
    const isChinese = language === "zh";

    if (!userLanguages[from]) {
        await sendLanguageMenu(from);
        return;
    }

    // English greetings
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

    // Chinese greetings
    const chineseGreetings = [
        "你好",
        "您好",
        "嗨",
        "早上好",
        "下午好",
        "晚上好"
    ];

    // Normalize English text
    const normalizedText = text
        .toLowerCase()
        .replace(/[.,!?:;'"()]/g, "")
        .trim();

    if (normalizedText === "booking") {
        await handleBooking(from);
        return;
    }

    // English closing messages
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

    // Chinese closing messages
    const chineseClosingMessages = [
        "谢谢",
        "谢谢你",
        "谢谢您",
        "好的",
        "好",
        "可以",
        "明白",
        "明白了",
        "知道了",
        "收到",
        "没问题",
        "再见",
        "拜拜"
    ];

    const containsEnglishGreeting = englishGreetings.some(greeting => {
        const regex = new RegExp(`\\b${greeting}\\b`, "i");
        return regex.test(text);
    });

    const containsChineseGreeting = chineseGreetings.some(greeting => {
        return text.includes(greeting);
    });

    const containsGreeting =
        containsEnglishGreeting ||
        containsChineseGreeting;

    // Recognize both English ? and Chinese ？
    const containsQuestion =
        text.includes("?") ||
        text.includes("？");

    // -----------------------------
    // 1. Greeting
    // -----------------------------
    if (containsGreeting) {
        await sendLanguageMenu(from);
        return;
    }

    // -----------------------------
    // 2. Closing / acknowledgement
    // -----------------------------

    const isEnglishClosing =
        englishClosingMessages.includes(normalizedText);

    const isChineseClosing =
        chineseClosingMessages.some(closing =>
            text.includes(closing)
        );

    if (isEnglishClosing || isChineseClosing) {
        await sendMessage(
            from,
            isChinese
                ? "不客气！如果您还有其他问题，欢迎随时联系我们。"
                : "You're welcome! If you need anything else, just send us a message."
        );

        return;
    }

    // -----------------------------
    // 3. Question
    // -----------------------------
    if (containsQuestion) {
        await notifyStaff(from, text);

        await sendMessage(
            from,
            isChinese
                ? "感谢您的问题。工作人员已收到通知，并会尽快回复您。"
                : "Thanks for your question. A staff member has been notified and will get back to you as soon as possible."
        );

        await sendContactNavigation(from);

        return;
    }

    // -----------------------------
    // 4. Everything else → staff
    // -----------------------------
    await notifyStaff(from, text);

    await sendMessage(
        from,
        isChinese
            ? "感谢您的留言。工作人员已收到通知，并会尽快回复您。"
            : "Thanks for your message. A staff member has been notified and will get back to you as soon as possible."
    );

    await sendContactNavigation(from);
}
//Interactive response Handler

async function handleInteractiveMessage(from, message) {
    if (message?.interactive?.type === "nfm_reply") {
        const draft = await getDraft(from);
        const date = readDateFlowReply(
            message.interactive.nfm_reply?.response_json, draft, getBookingDates()
        );
        if (!date) {
            await sendMessage(from, getLanguage(from) === "zh"
                ? "日期选择已失效，请重新选择。"
                : "That date selection has expired. Please choose again.");
            await sendAvailableDates(from);
            return;
        }
        await handleBookingDate(from, `BOOK_DATE_${date}`);
        delete draft.date_flow_token;
        delete draft.date_flow_expires_at;
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
    if (!verify360DialogWebhookSecret(req)) {
        console.warn(
            "Rejected webhook: invalid or missing webhook secret"
        );

        return res.sendStatus(401);
    }

    next();
}
//POST

app.post(
    "/webhook",
    requireValid360DialogSecret,
    async (req, res) => {
        try {
            const entries = req.body.entry || [];

            for (const entry of entries) {
                for (const change of entry.changes || []) {
                    const messages = change.value?.messages || [];

                    for (const message of messages) {
                        const messageId = message.id;
                        const from = message.from;

                        // Do not process a message that cannot
                        // be safely identified.
                        if (!messageId || !from) {
                            console.warn(
                                "Skipping message without ID or sender"
                            );
                            continue;
                        }

                        const { result, claimToken } =
                            await claimMessage(messageId);

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

                            // Ask Meta to retry rather than
                            // acknowledging unfinished work.
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

                            if (message.type === "text") {
                                await handleTextMessage(from, message);
                            }
                            else if (message.type === "interactive") {
                                await handleInteractiveMessage(
                                    from,
                                    message
                                );
                            }
                            else {
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
                        }
                        catch (processingError) {
                            console.error(
                                "Message processing failed:",
                                messageId,
                                JSON.stringify({
                                    status: processingError.response?.status,
                                    error: processingError.response?.data?.error || processingError.message
                                })
                            );

                            try {
                                await releaseMessage(
                                    messageId,
                                    claimToken
                                );
                            }
                            catch (releaseError) {
                                console.error(
                                    "Failed to release message claim:",
                                    releaseError
                                );
                            }

                            // Do not return 200 for unfinished work.
                            return res.sendStatus(500);
                        }
                    }
                }
            }

            return res.sendStatus(200);
        }
        catch (error) {
            console.error("Webhook error:", error);

            return res.sendStatus(500);
        }
    }
);
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBookingReminders();
});
