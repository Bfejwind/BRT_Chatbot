require("dotenv").config();

const express = require("express");
const axios = require("axios");
const {
    claimMessage,
    completeMessage,
    releaseMessage
} = require("./messageDeduplication");
const {
    getUpcomingEvents,
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
    FAQ_EXPECT: handleFAQExpect,
    FAQ_DURATION: handleFAQDuration,
    FAQ_BEGINNER: handleFAQBeginner,
    FAQ_BRING: handleFAQBring,
    FAQ_WEAR: handleFAQWear,
    FAQ_CHILDREN: handleFAQChildren,
    FAQ_CAFFEINE: handleFAQCaffeine,
    FAQ_CHANGE: handleFAQChange,
    FAQ_LATE: handleFAQLate,

    // Navigation
    BACK_FAQ: handleBackFAQ,
    MAIN_MENU: handleMainMenu,

    // Question handling
    QUESTION_FAQ: handleQuestionFAQ,
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
    markSessionCalendarSynced,
    getBookingSession
} = require("./bookingDatabase");
const crypto = require("node:crypto");
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

app.get("/", (req, res) => {
    res.send("WhatsApp bot is running");
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

function verifyMetaWebhookSignature(req) {
    const appSecret = process.env.META_APP_SECRET;
    const signature = req.get("X-Hub-Signature-256");

    // Fail closed if the server is not configured correctly.
    if (!appSecret) {
        console.error("META_APP_SECRET is not configured");
        return false;
    }

    // A valid signature requires the original request body.
    if (!Buffer.isBuffer(req.rawBody)) {
        console.error("Webhook raw body is unavailable");
        return false;
    }

    // Meta's signature must be sha256= followed by 64 hex characters.
    if (
        typeof signature !== "string" ||
        !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
    ) {
        return false;
    }

    const expectedSignature =
        "sha256=" +
        crypto
            .createHmac("sha256", appSecret)
            .update(req.rawBody)
            .digest("hex");

    const receivedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(
        expectedSignature,
        "utf8"
    );

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
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}
async function sendImage(to, imageUrl, caption = "") {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}
async function sendLanguageMenu(to) {
    try {
        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

        // 2. Wait 1.5 seconds
        await sleep(1500);

        // 3. Send the main menu
        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",

                interactive: {
                    type: "list",

                    body: {
                        text: isChinese
                            ? "请选择一个选项："
                            : "Please select an option:"
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
                    Authorization:
                        `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}

async function sendFAQMenu(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        const faqs = [
            {
                id: "FAQ_EXPECT",
                en: "What should I expect during a tea ceremony?",
                zh: "茶道体验包括什么？"
            },
            {
                id: "FAQ_DURATION",
                en: "How long does the tea ceremony take?",
                zh: "茶道体验需要多长时间？"
            },
            {
                id: "FAQ_BEGINNER",
                en: "Do I need to know anything about tea beforehand?",
                zh: "需要事先了解茶知识吗？"
            },
            {
                id: "FAQ_BRING",
                en: "Do I need to bring anything?",
                zh: "需要携带什么吗？"
            },
            {
                id: "FAQ_WEAR",
                en: "What should I wear?",
                zh: "应该穿什么？"
            },
            {
                id: "FAQ_CHILDREN",
                en: "Can children attend?",
                zh: "儿童可以参加吗？"
            },
            {
                id: "FAQ_CAFFEINE",
                en: "Does the tea contain caffeine?",
                zh: "茶含有咖啡因吗？"
            },
            {
                id: "FAQ_CHANGE",
                en: "Can I cancel or change my booking?",
                zh: "可以取消或更改预约吗？"
            },
            {
                id: "FAQ_LATE",
                en: "What if I am late to my booking?",
                zh: "如果预约迟到了怎么办？"
            }
        ];

        // WhatsApp list-row titles have a 24-character limit.
        // Display shortened titles while retaining full questions below.
        const shortTitles = {
            FAQ_EXPECT: ["What to expect?", "体验内容"],
            FAQ_DURATION: ["How long is it?", "体验时长"],
            FAQ_BEGINNER: ["Tea knowledge needed?", "需要茶知识吗？"],
            FAQ_BRING: ["What should I bring?", "需要携带什么？"],
            FAQ_WEAR: ["What should I wear?", "应该穿什么？"],
            FAQ_CHILDREN: ["Can children attend?", "儿童可以参加吗？"],
            FAQ_CAFFEINE: ["Does tea have caffeine?", "茶含咖啡因吗？"],
            FAQ_CHANGE: ["Change or cancel?", "更改或取消预约？"],
            FAQ_LATE: ["What if I'm late?", "如果迟到了？"]
        };

        const rows = faqs.map(faq => {
            const title = isChinese
                ? shortTitles[faq.id][1]
                : shortTitles[faq.id][0];

            const fullQuestion = isChinese ? faq.zh : faq.en;

            return {
                id: faq.id,
                title,
                // Only show a description when it adds different text.
                ...(title === fullQuestion
                    ? {}
                    : { description: fullQuestion })
            };
        });

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to,
                type: "interactive",
                interactive: {
                    type: "list",
                    header: {
                        type: "text",
                        text: isChinese
                            ? "常见问题"
                            : "Frequently Asked Questions"
                    },
                    body: {
                        text: isChinese
                            ? "请选择您想了解的问题："
                            : "Please select a question:"
                    },
                    action: {
                        button: isChinese
                            ? "查看问题"
                            : "View Questions",
                        sections: [
                            {
                                title: isChinese
                                    ? "常见问题"
                                    : "FAQs",
                                rows
                            }
                        ]
                    }
                }
            },
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("FAQ menu sent successfully");
    } catch (error) {
        console.error(
            "Error sending FAQ menu:",
            error.response?.data || error.message
        );
    }
}

async function handleBooking(from) {
    await startBooking(from);

    await sendAvailableDates(from);
}
async function sendAvailableDates(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        const rows = [];

        for (let i = 1; i <= 7; i++) {
            const date = new Date();

            date.setDate(date.getDate() + i);

            // Keep this value in YYYY-MM-DD because your code uses it internally
            const dateString = date.toLocaleDateString(
                "en-CA",
                {
                    timeZone: "Asia/Singapore"
                }
            );

            // Only change what the customer sees
            const displayDate = date.toLocaleDateString(
                isChinese ? "zh-CN" : "en-SG",
                {
                    timeZone: "Asia/Singapore",
                    weekday: "short",
                    day: "numeric",
                    month: "short"
                }
            );

            rows.push({
                id: `BOOK_DATE_${dateString}`,
                title: displayDate
            });
        }

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "list",
                    body: {
                        text: isChinese
                            ? "请选择预约日期。"
                            : "Please choose a booking date."
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}
async function getBookableSlots(date, partySize = 1) {
    const sessions = await getSessionAvailability(date);

    const slots = [];

    for (let hour = 12; hour < 17; hour++) {
        const time = `${String(hour).padStart(2, "0")}:00`;

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
            sessionId: session?.id
        });

        if (hasConflict) {
            continue;
        }

        const start = new Date(
            `${date}T${time}:00+08:00`
        );

        const end = new Date(
            start.getTime() + 60 * 60 * 1000
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
            const startTime = slot.start.toLocaleTimeString(
                isChinese ? "zh-CN" : "en-SG",
                {
                    timeZone: "Asia/Singapore",
                    hour: "2-digit",
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
                title: startTime,
                description: isChinese
                    ? `剩余 ${slot.remainingPlaces} 个名额`
                    : `${slot.remainingPlaces} places remaining`
            };
        });

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

    await axios.post(
        `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

    await axios.post(
        `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: {
                    text: isChinese
                        ? `请确认您的预约申请。\n\n日期：${booking.booking_date}\n时间：${booking.booking_time}\n人数：${booking.party_size} 位`
                        : `Please confirm your booking request.\n\nDate: ${booking.booking_date}\nTime: ${booking.booking_time}\nGroup size: ${booking.party_size}`
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
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
                ? `您的预约已确认！\n\n日期：${booking.booking_date}\n时间：${booking.booking_time}\n人数：${booking.party_size} 位`
                : `Your booking is confirmed!\n\nDate: ${booking.booking_date}\nTime: ${booking.booking_time}\nGroup size: ${booking.party_size}`
        );

    } catch (error) {
        console.error("Booking confirmation error:", error);

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

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                            `Time: ${booking.booking_time}\n` +
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}
async function sendNavigationMenu(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
    }
}

async function sendContactNavigation(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization:
                        `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

    } catch (error) {
        console.error(
            "Error sending contact navigation:",
            error.response?.data || error.message
        );
    }
}

async function sendQuestionOptions(to) {
    try {
        const isChinese = getLanguage(to) === "zh";

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
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
                    Authorization:
                        `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

    } catch (error) {
        console.error(
            "Error sending question options:",
            error.response?.data || error.message
        );
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
    }
}
//Functions
// =========================
// MAIN MENU HANDLERS
// =========================

async function handleFAQ(from) {
    await sendFAQMenu(from);
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

    // Only accept the date format used by your menu.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        await sendMessage(
            from,
            isChinese ? "预约日期无效。" : "Invalid booking date."
        );
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
    await sendFAQMenu(from);
}

async function handleMainMenu(from) {
    await sendMainMenu(from);
}


// =========================
// QUESTION HANDLERS
// =========================

async function handleQuestionFAQ(from) {
    await sendFAQMenu(from);
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

    // Check English greeting
    const containsEnglishGreeting = englishGreetings.some(greeting => {
        const regex = new RegExp(`\\b${greeting}\\b`, "i");
        return regex.test(text);
    });

    // Check Chinese greeting
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
        if (!userLanguages[from]) {
            await sendLanguageMenu(from);
        }
        else {
            await sendMainMenu(from);
        }

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
        pendingQuestions[from] = text;

        await sendQuestionOptions(from);

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

    if (selectionId.startsWith("BOOK_SIZE_")) {
        await handleBookingPartySize(from, selectionId);
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

    const handler = interactionHandlers[selectionId];

    if (handler) {
        await handler(from);
    } else {
        console.log("No handler found for:", selectionId);
    }
}

function requireValidMetaSignature(req, res, next) {
    if (!verifyMetaWebhookSignature(req)) {
        console.warn(
            "Rejected webhook: invalid or missing Meta signature"
        );

        return res.sendStatus(401);
    }

    next();
}
//POST

app.post(
    "/webhook",
    requireValidMetaSignature,
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
                                processingError
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
});