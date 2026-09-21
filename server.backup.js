require("dotenv").config();

const express = require("express");
const axios = require("axios");
const {
    getUpcomingEvents,
    getAvailableSlots,
    createBookingEvent
} = require("./calendarService");
const userLanguages = {};
const app = express();
const pendingQuestions = {};
const interactionHandlers = {
    LANG_EN: handleEnglishLanguage,
    LANG_ZH: handleChineseLanguage,
    // Main Menu
    FAQ: handleFAQ,
    SERVICES: handleServices,
    BOOKING: handleBooking,
    CONTACT: handleContact,
    BOOK_CONFIRM: handleBookingConfirm,
    BOOK_CANCEL: handleBookingCancel,

    // FAQ
    FAQ_HOURS: handleFAQHours,
    FAQ_TEACEREMONY: handleFAQTeaCeremony,
    FAQ_RULES: handleFAQRules,
    FAQ_LEAVES: handleFAQLeaves,
    FAQ_PRICES: handleFAQTeaPrices,

    // Services
    SERVICE_TEA: handleServiceTea,
    SERVICE_WATER: handleServiceWater,
    SERVICE_MUSEUM: handleServiceMuseum,

    // Navigation
    BACK_FAQ: handleBackFAQ,
    BACK_SERVICES: handleBackServices,
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
    submitBooking,
    cancelDraft,
    getBookingById,
    claimBooking,
    reserveSlot,
    releaseSlot,
    updateBooking
} = require("./bookingDatabase");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getLanguage(from) {
    return userLanguages[from] || "en";
}
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("WhatsApp bot is running");
});
app.get("/test-calendar", async (req, res) => {
    try {
        const events = await getUpcomingEvents();

        const simplifiedEvents = events.map(event => ({
            id: event.id,
            name: event.summary,
            start: event.start,
            end: event.end
        }));

        console.log("Calendar events:");
        console.log(simplifiedEvents);

        res.json(simplifiedEvents);
    }
    catch (error) {
        console.error(
            "Calendar error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to read calendar"
        });
    }
});
app.get("/test-availability/:date", async (req, res) => {
    try {
        const date = req.params.date;

        const slots = await getAvailableSlots(date);

        const simplifiedSlots = slots.map(slot => ({
            start: slot.start.toLocaleTimeString(
                "en-SG",
                {
                    timeZone: "Asia/Singapore",
                    hour: "2-digit",
                    minute: "2-digit"
                }
            ),
            end: slot.end.toLocaleTimeString(
                "en-SG",
                {
                    timeZone: "Asia/Singapore",
                    hour: "2-digit",
                    minute: "2-digit"
                }
            )
        }));

        res.json(simplifiedSlots);
    }
    catch (error) {
        console.error(
            "Availability error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to calculate availability"
        });
    }
});
app.get("/test-create-event", async (req, res) => {
    try {
        const event = await createBookingEvent({
            customerName: "Test Customer",
            customerPhone: "6580000000",
            startDateTime:
                "2026-09-20T15:00:00+08:00",
            endDateTime:
                "2026-09-20T16:00:00+08:00"
        });

        res.json({
            message: "Event created",
            eventId: event.id
        });
    }
    catch (error) {
        console.error(
            "Create event error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            error: "Failed to create calendar event"
        });
    }
});
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
                                        id: "SERVICES",
                                        title: isChinese
                                            ? "🏛️ 服务"
                                            : "🏛️ Services"
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
        const language = getLanguage(to);
        const isChinese = language === "zh";

        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
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
                            ? "您想了解什么？"
                            : "What would you like to know?"
                    },

                    action: {
                        button: isChinese
                            ? "查看常见问题"
                            : "View FAQs",

                        sections: [
                            {
                                title: isChinese
                                    ? "常见问题"
                                    : "FAQs",

                                rows: [
                                    {
                                        id: "FAQ_HOURS",

                                        title: isChinese
                                            ? "🕒 营业时间"
                                            : "🕒 Opening Hours",

                                        description: isChinese
                                            ? "查看我们的营业时间"
                                            : "View our opening hours"
                                    },

                                    {
                                        id: "FAQ_TEACEREMONY",

                                        title: isChinese
                                            ? "🍵 茶道"
                                            : "🍵 Tea Ceremony",

                                        description: isChinese
                                            ? "什么是茶道？"
                                            : "What is Tea Ceremony?"
                                    },

                                    {
                                        id: "FAQ_RULES",

                                        title: isChinese
                                            ? "📜 茶道礼仪"
                                            : "📜 Tea Rules",

                                        description: isChinese
                                            ? "了解茶道礼仪"
                                            : "Tea ceremony etiquette"
                                    },

                                    {
                                        id: "FAQ_LEAVES",

                                        title: isChinese
                                            ? "🍃 茶叶"
                                            : "🍃 Tea Leaves",

                                        description: isChinese
                                            ? "了解我们的茶叶"
                                            : "Learn about our tea leaves"
                                    },

                                    {
                                        id: "FAQ_PRICES",

                                        title: isChinese
                                            ? "💰 茶道价格"
                                            : "💰 Tea Ceremony Prices",

                                        description: isChinese
                                            ? "查看我们的收费标准"
                                            : "Check our pricing"
                                    }
                                ]
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

        console.log("FAQ menu sent");
    }
    catch (error) {
        console.error(
            "Error sending FAQ menu:",
            error.response?.data || error.message
        );
    }
}
async function sendServicesMenu(to) {
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
                            ? "我们的服务\n\n您想了解哪项服务？"
                            : "Our Services\n\nWhich service would you like to learn more about?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_TEA",
                                    title: isChinese
                                        ? "茶道体验"
                                        : "Tea Ceremony"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_WATER",
                                    title: isChinese
                                        ? "冰川水"
                                        : "Glacial Water"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_MUSEUM",
                                    title: isChinese
                                        ? "博物馆导览"
                                        : "Museum Tour"
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

        console.log("Services menu sent successfully");
        console.log(response.data);

    } catch (error) {
        console.error(
            "Error sending Services menu:",
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
async function sendAvailableTimes(to, date) {
    try {
        const isChinese = getLanguage(to) === "zh";

        const slots = await getAvailableSlots(date);

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
                title: startTime
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
async function sendBookingConfirmation(to) {
    const booking = await getDraft(to);
    const isChinese = getLanguage(to) === "zh";

    if (!booking?.booking_date || !booking?.booking_time) {
        await sendMessage(
            to,
            isChinese
                ? "预约出现问题，请重新尝试。"
                : "Something went wrong with your booking. Please try again."
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
                        ? `请确认您的预约申请。\n\n日期：${booking.booking_date}\n时间：${booking.booking_time}`
                        : `Please confirm your booking request.\n\nDate: ${booking.booking_date}\nTime: ${booking.booking_time}`
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

    const booking = await submitBooking(from);

    if (!booking) {
        await sendMessage(
            from,
            isChinese
                ? "找不到您的预约信息，请重新开始预约。"
                : "Your booking information could not be found. Please start again."
        );

        return;
    }

    await sendBookingRequestToStaff(from, booking);

    await sendMessage(
        from,
        isChinese
            ? "您的预约申请已发送给工作人员审核。"
            : "Your booking request has been sent to our staff for approval."
    );
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
                            `Time: ${booking.booking_time}`
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
async function sendServicesNavigation(to) {
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
                            ? "您想了解其他服务吗？"
                            : "Would you like to explore another service?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_SERVICES",
                                    title: isChinese
                                        ? "返回服务"
                                        : "Back to Services"
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

        console.log("Services navigation sent successfully");

    } catch (error) {
        console.error(
            "Error sending Services navigation:",
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
async function sendTeaCeremonyMenu(to) {
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
                            ? "茶道体验\n\n" +
                              "体验使用来自中国的冰川水进行的传统茶道。\n\n" +
                              "您想预约吗？"
                            : "Tea Ceremony\n\n" +
                              "Experience our traditional tea ceremony using glacial water from China.\n\n" +
                              "Would you like to make a booking?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BOOK_TEA",
                                    title: isChinese
                                        ? "立即预约"
                                        : "Book Now"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_SERVICES",
                                    title: isChinese
                                        ? "返回服务"
                                        : "Back to Services"
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

        console.log("Tea ceremony menu sent successfully");
        console.log(response.data);

    } catch (error) {
        console.error(
            "Error sending tea ceremony menu:",
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

async function handleServices(from) {
    await sendServicesMenu(from);
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
    const date = selectionId.replace("BOOK_DATE_", "");

    // Only accept the date format used by your menu.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        await sendMessage(from, "Invalid booking date.");
        return;
    }

    const draft = await getDraft(from);

    if (!draft) {
        await sendMessage(
            from,
            "Your booking session could not be found. Please start again."
        );
        return;
    }

    await saveBookingDate(from, date);

    console.log("Selected booking date:", date);

    await sendAvailableTimes(from, date);
}

async function handleBookingTime(from, selectionId) {
    const time = selectionId.replace("BOOK_TIME_", "");

    if (!/^\d{2}:\d{2}$/.test(time)) {
        await sendMessage(from, "Invalid booking time.");
        return;
    }

    const draft = await getDraft(from);

    if (!draft?.booking_date) {
        await sendMessage(
            from,
            "Your booking date could not be found. Please start again."
        );
        return;
    }

    // Do not trust an old WhatsApp menu.
    // Check that the selected time is still offered.
    const currentSlots = await getAvailableSlots(
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
            "That time is no longer available. Please choose another."
        );

        await sendAvailableTimes(
            from,
            draft.booking_date
        );

        return;
    }

    await saveBookingTime(from, time);

    console.log("Selected booking time:", time);

    await sendBookingConfirmation(from);
}

async function handleBookingApproval(from, selectionId) {
    // Only the configured staff number may approve.
    if (from !== process.env.STAFF_PHONE_NUMBER) {
        console.warn("Unauthorized approval attempt");
        return;
    }

    const bookingId = selectionId.replace("APPROVE_", "");

    // Atomically claim this pending request.
    const booking = await claimBooking(bookingId);

    if (!booking) {
        await sendMessage(
            from,
            "This booking is no longer pending or has already been handled."
        );
        return;
    }

    // Prevent another approval through this bot
    // from reserving the same slot.
    const reservation = await reserveSlot(booking);

    if (!reservation) {
        await updateBooking(
            booking.id,
            "approving",
            { status: "slot_unavailable" }
        );

        await sendMessage(
            from,
            "This time has already been reserved by another booking."
        );

        await sendMessage(
            booking.customer_phone,
            "Sorry, your selected time is no longer available. Please start a new booking."
        );

        return;
    }

    try {
        // Recheck Google Calendar AT APPROVAL TIME.
        const currentSlots = await getAvailableSlots(
            booking.booking_date
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

            return slotTime === booking.booking_time;
        });

        if (!selectedSlot) {
            await updateBooking(
                booking.id,
                "approving",
                { status: "slot_unavailable" }
            );

            await releaseSlot(booking.id);

            await sendMessage(
                from,
                "This booking time is no longer available in Google Calendar."
            );

            await sendMessage(
                booking.customer_phone,
                "Sorry, your selected time is no longer available. Please start a new booking."
            );

            return;
        }

        // Create the actual Calendar event.
        const event = await createBookingEvent({
            customerName: "WhatsApp Customer",
            customerPhone: booking.customer_phone,
            startDateTime:
                selectedSlot.start.toISOString(),
            endDateTime:
                selectedSlot.end.toISOString()
        });

        if (!event?.id) {
            throw new Error(
                "Calendar did not return an event ID"
            );
        }

        // Save the Calendar event ID and approval.
        const approved = await updateBooking(
            booking.id,
            "approving",
            {
                status: "approved",
                google_calendar_event_id: event.id
            }
        );

        if (!approved) {
            throw new Error(
                "Calendar event created but booking database update failed"
            );
        }

        const isChinese =
            getLanguage(booking.customer_phone) === "zh";

        await sendMessage(
            booking.customer_phone,
            isChinese
                ? `您的预约已确认。\n\n日期：${booking.booking_date}\n时间：${booking.booking_time}`
                : `Your booking has been confirmed.\n\nDate: ${booking.booking_date}\nTime: ${booking.booking_time}`
        );

        await sendMessage(
            from,
            "Booking approved and added to Google Calendar."
        );

    } catch (error) {
        console.error(
            "Booking approval needs attention:",
            booking.id,
            error
        );

        // Deliberately leave the booking as "approving"
        // and retain its slot reservation.
        //
        // Calendar creation might have succeeded even
        // if the response or database update failed.
        // Automatically retrying could create a
        // duplicate Calendar event.

        await sendMessage(
            from,
            `Booking ${booking.id} needs manual checking. Check Google Calendar before trying again.`
        );
    }
}

async function handleBookingRejection(from, selectionId) {
    if (from !== process.env.STAFF_PHONE_NUMBER) {
        console.warn("Unauthorized rejection attempt");
        return;
    }

    const bookingId = selectionId.replace("REJECT_", "");

    const booking = await getBookingById(bookingId);

    if (!booking || booking.status !== "pending") {
        await sendMessage(
            from,
            "This booking is no longer pending or has already been handled."
        );
        return;
    }

    const rejected = await updateBooking(
        booking.id,
        "pending",
        { status: "rejected" }
    );

    if (!rejected) {
        await sendMessage(
            from,
            "This booking was already handled."
        );
        return;
    }

    const isChinese =
        getLanguage(booking.customer_phone) === "zh";

    await sendMessage(
        booking.customer_phone,
        isChinese
            ? `您在 ${booking.booking_date} ${booking.booking_time} 的预约申请未获批准。\n\n请选择其他日期或时间。`
            : `Your booking request for ${booking.booking_date} at ${booking.booking_time} was not approved.\n\nPlease choose another date or time.`
    );

    await sendMessage(
        from,
        "Booking rejected."
    );
}



// =========================
// FAQ HANDLERS
// =========================

async function handleFAQHours(from) {
    const language = getLanguage(from);
    
    if (language === "zh") {
        await sendMessage(
            from,
            "我们的营业时间是中午12点至下午5点。"
        );
    }
    else {
        await sendMessage(
            from,
            "Our opening hours are from 12 PM to 5 PM."
        );
    }
    
    await sendNavigationMenu(from);
}

async function handleFAQTeaCeremony(from) {
    const language = getLanguage(from);
    await sendImage(
        from,
        images.teaCeremony
    );

    // 2. Wait so the image appears before the text
    await sleep(2000);
    
    if (language === "zh") {
        await sendMessage(
            from,
            "茶道是一种以细心和尊重的态度泡茶、奉茶的传统文化习俗。它不仅仅是品茶，更体现了待客之道、专注、文化与欣赏，并通过共享品茶的体验拉近人与人之间的距离。"
        );
    }
    else {
        await sendMessage(
            from,
            "A tea ceremony is a traditional practice of preparing and serving tea with care and respect. It is more than simply drinking tea—it reflects hospitality, mindfulness, culture, and appreciation, bringing people together through the shared experience of tea."
        );
    }
    await sleep(2000);

    await sendNavigationMenu(from);
}

async function handleFAQRules(from) {
    const language = getLanguage(from);
    
    if (language === "zh") {
        await sendMessage(
            from,
            "茶道仪式进行期间，请将手机调至静音，并尽量避免交谈，让所有宾客都能享受体验。"
        );
    }
    else {
        await sendMessage(
            from,
            "During the tea ceremony, please silence your handphone and refrain from talking so everyone can enjoy the experience."
        );
    }
    
    await sendNavigationMenu(from);
}

async function handleFAQLeaves(from) {
    const isChinese = getLanguage(from) === "zh";
    
    await sendMessage(
        from,
        isChinese
        ? "这里填写有关茶叶的中文答案。"
        : "YOUR TEA LEAVES ANSWER HERE"
    );
    
    await sendNavigationMenu(from);
}

async function handleFAQTeaPrices(from) {
    const isChinese = getLanguage(from) === "zh";

    await sendImage(
        from,
        images.ceremonyPrices,
        isChinese
            ? "查看我们的配套优惠，与亲朋好友一起分享这份体验。"
            : "Check out our package deals to share the experience"
    );
    await sleep(2000);

    await sendNavigationMenu(from);
}


// =========================
// SERVICE HANDLERS
// =========================

async function handleServiceTea(from) {
    const isChinese = getLanguage(from) === "zh";
    
    await sendMessage(
        from,
        isChinese
        ? "茶道体验\n\n体验我们的传统茶道。"
        : "Tea Ceremony\n\nExperience our traditional tea ceremony."
    );
    
    await sendServicesNavigation(from);
}

async function handleServiceWater(from) {
    const isChinese = getLanguage(from) === "zh";
    
    await sendMessage(
        from,
        isChinese
        ? "我们的冰川水来自中国。"
        : "Our glacial water is sourced from China."
    );
    
    await sendServicesNavigation(from);
}

async function handleServiceMuseum(from) {
    const isChinese = getLanguage(from) === "zh";
    
    await sendMessage(
        from,
        isChinese
        ? "博物馆导览\n\n通过我们的导览服务，更深入地了解博物馆。"
        : "Museum Tour\n\nLearn more about our museum through our guided tour."
    );
    
    await sendServicesNavigation(from);
}


// =========================
// NAVIGATION HANDLERS
// =========================

async function handleBackFAQ(from) {
    await sendFAQMenu(from);
}

async function handleBackServices(from) {
    await sendServicesMenu(from);
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

    if (message.interactive.type === "button_reply") {
        selectionId = message.interactive.button_reply.id;
    }

    else if (message.interactive.type === "list_reply") {
        selectionId = message.interactive.list_reply.id;
    }

    if (!selectionId) {
        console.log("Unknown interactive message");
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
    if (selectionId.startsWith("APPROVE_")) {
        await handleBookingApproval(from, selectionId);
        return;
    }

    if (selectionId.startsWith("REJECT_")) {
        await handleBookingRejection(from, selectionId);
        return;
    }

    const handler = interactionHandlers[selectionId];

    if (handler) {
        await handler(from);
    }
    else {
        console.log("No handler found for:", selectionId);
    }
}
//POST
app.post("/webhook", async (req, res) => {

    try {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        
        if (!value?.messages) {
            return res.sendStatus(200);
        }
        
        const message = value.messages[0];
        const from = message.from;

        console.log("Message from:", from);

        if (message.type === "text") {
            await handleTextMessage(from, message);
        }

        else if (message.type === "interactive") {
            await handleInteractiveMessage(from, message);
        }

    }
    catch (error) {
        console.error("Error reading webhook:", error);
    }

    res.sendStatus(200);
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});