require("dotenv").config();

const express = require("express");
const axios = require("axios");
const app = express();
const pendingQuestions = {};

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("WhatsApp bot is running");
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
async function sendMainMenu(to) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Welcome! How can we help you today?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "FAQ",
                                    title: "FAQ"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICES",
                                    title: "Services"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "CONTACT",
                                    title: "Contact Us"
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

        console.log("Main menu sent successfully");
        console.log(response.data);

    } catch (error) {
        console.error(
            "Error sending main menu:",
            error.response?.data || error.message
        );
    }
}
async function sendFAQMenu(to) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Frequently Asked Questions\n\nWhat would you like to know?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "FAQ_HOURS",
                                    title: "Opening Hours"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "FAQ_WATER",
                                    title: "Glacial Water"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "FAQ_RULES",
                                    title: "Tea Rules"
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

        console.log("FAQ menu sent successfully");
        console.log(response.data);

    } catch (error) {
        console.error(
            "Error sending FAQ menu:",
            error.response?.data || error.message
        );
    }
}
async function sendServicesMenu(to) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Our Services\n\nWhich service would you like to learn more about?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_TEA",
                                    title: "Tea Ceremony"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_WATER",
                                    title: "Glacial Water"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "SERVICE_MUSEUM",
                                    title: "Museum Tour"
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
async function sendNavigationMenu(to) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Would you like to see anything else?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_FAQ",
                                    title: "Back to FAQ"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: "Main Menu"
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
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "Would you like to explore another service?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_SERVICES",
                                    title: "Back to Services"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: "Main Menu"
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
        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "What would you like to do next?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: "Main Menu"
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
        const response = await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text:
                            "Tea Ceremony\n\n" +
                            "Experience our traditional tea ceremony using glacial water from China.\n\n" +
                            "Would you like to make a booking?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "BOOK_TEA",
                                    title: "Book Now"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "BACK_SERVICES",
                                    title: "Back to Services"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: "Main Menu"
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
        await axios.post(
            `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text:
                            "Your question may already be answered in our FAQ. " +
                            "Would you like to check the FAQ first?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "QUESTION_FAQ",
                                    title: "Check FAQ"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "QUESTION_STAFF",
                                    title: "Contact Staff"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "MAIN_MENU",
                                    title: "Main Menu"
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
        await sendMessage(
            process.env.STAFF_PHONE_NUMBER,
            `New customer message\n\n` +
            `Customer: +${customerNumber}\n\n` +
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
app.post("/webhook", async (req, res) => {
    const body = req.body;

    try {
        const value = body.entry[0].changes[0].value;

        if (value.messages) {
            const message = value.messages[0];
            const from = message.from;

            console.log("Message from:", from);

            // Normal text message
            if (message.type === "text") {
                const text = message.text.body.trim();

                const greetings = [
                    "hi",
                    "hello",
                    "hey",
                    "hiya",
                    "howdy",
                    "good morning",
                    "good afternoon",
                    "good evening"
                ];

                const containsGreeting = greetings.some(greeting => {
                    const regex = new RegExp(`\\b${greeting}\\b`, "i");
                    return regex.test(text);
                });

                const containsQuestion = text.includes("?");

                if (containsQuestion) {

                    pendingQuestions[from] = text;

                    await sendQuestionOptions(from);

                } else if (containsGreeting) {

                    await sendMainMenu(from);

                } else {

                    await notifyStaff(from, text);
                }
            }

            // Button press
            if (message.type === "interactive") {
    const interactive = message.interactive;

        if (interactive.type === "button_reply") {
            const buttonId =
                interactive.button_reply.id;

            console.log(
                "Button pressed:",
                buttonId
            );

            if (buttonId === "FAQ") {
                await sendFAQMenu(from);
            }

            else if (buttonId === "SERVICES") {
                await sendServicesMenu(from);
            }

            else if (buttonId === "CONTACT") {

                // Tell the customer
                await sendMessage(
                    from,
                    "A staff member has been notified and will get back to you as soon as possible."
                );

                // Notify the staff member
                await notifyStaff(from, text);

                // Give customer a way back
                await sendContactNavigation(from);
            }

            else if (buttonId === "FAQ_HOURS") {
                await sendMessage(
                    from,
                    "Our opening hours are from 12 PM to 5 PM."
                );
                await sendNavigationMenu(from);
            }

            else if (buttonId === "FAQ_WATER") {
                await sendMessage(
                    from,
                    "The water used during the tea ceremony is glacial water sourced from China."
                );
                await sendNavigationMenu(from);
            }

            else if (buttonId === "FAQ_RULES") {
                await sendMessage(
                    from,
                    "During the tea ceremony, please silence your handphone and refrain from talking so everyone can enjoy the experience."
                );
                await sendNavigationMenu(from);
            }
            else if (buttonId === "BACK_FAQ") {
                await sendFAQMenu(from);
            }
            else if (buttonId === "BACK_SERVICES") {
                await sendServicesMenu(from);
            }

            else if (buttonId === "MAIN_MENU") {
                await sendMainMenu(from);
            }
            else if (buttonId === "SERVICE_TEA") {
                await sendMessage(
                    from,
                    "Tea Ceremony\n\nExperience our traditional tea ceremony."
                );

                await sendServicesNavigation(from);
            }

            else if (buttonId === "SERVICE_WATER") {
                await sendMessage(
                    from,
                    "Purchase of Glacial Water\n\nGlacial water used in our tea ceremony is available for purchase."
                );

                await sendServicesNavigation(from);
            }

            else if (buttonId === "SERVICE_MUSEUM") {
                await sendMessage(
                    from,
                    "Museum Tour\n\nLearn more about our museum through our guided tour."
                );

                await sendServicesNavigation(from);
            }
            else if (buttonId === "QUESTION_FAQ") {
                await sendFAQMenu(from);
            }

            else if (buttonId === "QUESTION_STAFF") {

                const originalQuestion = pendingQuestions[from];

                if (originalQuestion) {
                    await notifyStaff(from, originalQuestion);

                    delete pendingQuestions[from];
                }

                await sendMessage(
                    from,
                    "A staff member has been notified and will get back to you as soon as possible."
                );
            }
        }
    }
        }

    } catch (error) {
        console.error(
            "Error reading webhook:",
            error
        );
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});