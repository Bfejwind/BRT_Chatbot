// Booking questions are handled before the date/calendar stage.
function createBookingJourney({ getDraft, startBooking, checkPackage, sendButtons,
    sendMessage, notifyStaff, showDates, showMainMenu, isChinese, ceremonyPrices }) {
    async function ask(from, en, zh, options, imageUrl) {
        await sendButtons(from, isChinese(from) ? zh : en, options.map(([id, en, zh]) => ({
            id: `JOURNEY_${id}`, title: isChinese(from) ? zh : en
        })), imageUrl);
    }
    async function bookingType(from) {
        const draft = await getDraft(from);
        const privateEn = draft.first_visit
            ? "If you prefer a private session, please note that the first-session promotional price does not apply. Private sessions are priced differently, and our staff will be happy to help arrange your visit and share the pricing with you."
            : "If you prefer a private session, please note that membership packages do not apply. Private sessions are priced differently, and our staff will be happy to help arrange your visit and share the pricing with you.";
        const privateZh = draft.first_visit
            ? "若您希望预约私人场次，温馨提醒您：首次体验优惠价不适用于私人预约。私人场次收费有所不同，需要由工作人员协助安排。我们很乐意为您介绍价格并安排到访。"
            : "若您希望预约私人场次，温馨提醒您：会员配套不适用于私人预约。私人场次收费有所不同，需要由工作人员协助安排。我们很乐意为您介绍价格并安排到访。";
        await ask(from, "Would you prefer a public or private session?\n\n" +
            (draft.first_visit ? "Promotion $68 Public session\n\n" : "") + privateEn,
            "您希望参加公众场次还是私人场次？\n\n" +
            (draft.first_visit ? "$68优惠公众场次\n\n" : "") + privateZh, [
                ["PUBLIC", draft.first_visit ? "Promo $68 Public" : "Public session", draft.first_visit ? "$68优惠公众场次" : "公众场次"], ["PRIVATE", "Private session", "私人场次"]
            ]);
    }
    async function purchase(from) {
        await ask(from, "Would you like to purchase a package?\n\nIf you prefer not to purchase a package, our staff will be happy to help arrange a private session. Membership packages do not apply to private bookings, and pricing is different.", "您想购买配套吗？\n\n若您暂时不想购买配套，我们的工作人员很乐意协助您安排私人场次。会员配套不适用于私人预约，收费也有所不同。", [
            ["BUY", "Yes, contact staff", "是，联系工作人员"], ["NO_BUY", "No, private booking", "否，预约私人场次"]
        ], ceremonyPrices);
    }
    async function select(from, choice) {
        const draft = await getDraft(from);
        if (!draft) return begin(from);
        if (choice === "FIRST" && draft.journey_step === "first") {
            draft.first_visit = true; draft.journey_step = "type";
            return bookingType(from);
        }
        if (choice === "RETURNING" && draft.journey_step === "first") {
            draft.first_visit = false; draft.journey_step = "package";
            return ask(from, "Have you purchased a package with us?", "您曾向我们购买配套吗？", [
                ["HAS_PACKAGE", "Yes", "是"], ["NO_PACKAGE", "No", "否"]
            ]);
        }
        if (["HAS_PACKAGE", "NO_PACKAGE"].includes(choice) && draft.journey_step === "package") {
            if (choice === "HAS_PACKAGE") {
                let verified;
                try { verified = await checkPackage(from); } catch {
                    await notifyStaff(from, "Please verify this customer's package; automatic verification is unavailable.");
                    return sendMessage(from, isChinese(from) ? "工作人员将核实您的配套，请等待回复。" : "Staff will verify your package. Please wait for their reply.");
                }
                if (verified) {
                    draft.package_verified = true;
                    draft.package_routes = verified.allowed_routes;
                    draft.journey_step = "type";
                    return bookingType(from);
                }
                draft.package_verified = false;
                draft.package_routes = [];
                await sendMessage(from, isChinese(from)
                    ? "暂时未找到可使用的配套，您的配套可能已到期或次数已用完。如需协助，我们的工作人员很乐意为您核实。您也可以购买新的配套。"
                    : "We couldn't find a package available to use at the moment. It may have expired or have no visits left. Our staff will be happy to help check this for you, or you can purchase a new package.");
            }
            draft.journey_step = "purchase";
            return purchase(from);
        }
        if (choice === "PRIVATE" && draft.journey_step === "type") {
            draft.journey_step = "staff";
            await notifyStaff(from, "Customer requests a private tea session.");
            return sendMessage(from, isChinese(from) ? "私人场次需由工作人员安排，我们会尽快回复您。" : "Staff will arrange your private session and reply as soon as possible.");
        }
        if (choice === "PUBLIC" && draft.journey_step === "type") {
            if (draft.first_visit) {
                draft.booking_route = "first_public"; draft.journey_step = "dates";
                return showDates(from);
            }
            if (draft.package_verified) {
                draft.journey_step = "category";
                return ask(from, "Choose your public session category. All sessions are 4:00–5:30 PM.",
                    "请选择公众场次类别。所有场次均为16:00–17:30。", [
                        ["WEEKDAY", "Weekday (Mon–Thu)", "平日（周一至周四）"],
                        ["WEEKEND", "Weekend (Fri–Sun)", "周末（周五至周日）"],
                        ["EXCLUSIVE", "Exclusive", "专享"],
                        ["PREMIUM", "Premium", "高级"]
                    ].filter(([id]) => draft.package_routes.includes(id.toLowerCase())));
            }
        }
        if (["WEEKDAY", "WEEKEND", "EXCLUSIVE", "PREMIUM"].includes(choice) &&
            draft.journey_step === "category" && draft.package_verified &&
            draft.package_routes.includes(choice.toLowerCase())) {
            draft.booking_route = choice.toLowerCase(); draft.journey_step = "dates";
            return showDates(from);
        }
        if (choice === "BUY" && draft.journey_step === "purchase") {
            draft.journey_step = "staff";
            await notifyStaff(from, "Customer wants to purchase a package.");
            await sendMessage(from, isChinese(from) ? "工作人员会协助您购买配套。购买完成后，请从主菜单重新预约。" : "Staff will help you purchase a package. Once complete, return to the main menu to book.");
            return showMainMenu(from);
        }
        if (choice === "NO_BUY" && draft.journey_step === "purchase") {
            draft.journey_step = "staff";
            await notifyStaff(from, "Customer declined to purchase a package and requests a private tea session. Please assist with arrangements and pricing.");
            return sendMessage(from, isChinese(from)
                ? "我们已通知工作人员协助您安排私人场次。会员配套不适用于私人预约，收费也有所不同。欢迎在此发送您希望预约的日期、时间及人数，我们会尽快回复您并介绍价格。"
                : "We've notified our staff to help arrange your private session. Membership packages do not apply to private bookings, and pricing is different. Please send your preferred date, time and group size here, and our team will get back to you as soon as possible with the pricing and arrangements.");
        }
        return sendMessage(from, isChinese(from) ? "此选项已失效，请重新开始预约。" : "That option has expired. Please start a new booking.");
    }
    async function begin(from) {
        const draft = await startBooking(from);
        draft.journey_step = "first";
        await ask(from, "Is this your first time with us?", "这是您第一次到访吗？", [
            ["FIRST", "Yes, first visit", "是，首次到访"], ["RETURNING", "No, returning guest", "否，再次到访"]
        ]);
    }
    return { begin, select };
}
module.exports = { createBookingJourney };
