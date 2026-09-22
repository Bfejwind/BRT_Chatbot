const { google } = require("googleapis");

const BOOKING_CONFIG = {
    openHour: 12,
    closeHour: 17,
    durationMinutes: 60
};
function getSessionStart(bookingDate, bookingTime) {
    const date = String(bookingDate).slice(0, 10);
    const time = String(bookingTime).slice(0, 5);

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^\d{2}:\d{2}$/.test(time)
    ) {
        throw new Error("Invalid session date or time");
    }

    const start = new Date(`${date}T${time}:00+08:00`);

    if (Number.isNaN(start.getTime())) {
        throw new Error("Invalid session date or time");
    }

    return start;
}
function getSessionCalendarEventId(sessionId) {
    const normalizedId = String(sessionId)
        .replace(/-/g, "")
        .toLowerCase();

    if (!/^[0-9a-f]{32}$/.test(normalizedId)) {
        throw new Error("Invalid booking session ID");
    }

    return `booking${normalizedId}`;
}

const googleCredentials = process.env.GOOGLE_CREDENTIALS_JSON
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    : undefined;

if (process.env.RENDER && !googleCredentials) {
    throw new Error(
        "GOOGLE_CREDENTIALS_JSON is missing from Render environment variables"
    );
}

const auth = new google.auth.GoogleAuth({
    ...(googleCredentials
        ? { credentials: googleCredentials }
        : { keyFile: "google-service-account.json" }),
    scopes: [
        "https://www.googleapis.com/auth/calendar"
    ]
});

const calendar = google.calendar({
    version: "v3",
    auth: auth
});

async function getUpcomingEvents() {
    const response = await calendar.events.list({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        timeMin: new Date().toISOString(),
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

        events.push(...(response.data.items || []));
        pageToken = response.data.nextPageToken;
    } while (pageToken);

    return events;
}
async function getAvailableSlots(dateString) {

    const startOfDay = new Date(
        `${dateString}T00:00:00+08:00`
    );

    const endOfDay = new Date(
        `${dateString}T23:59:59+08:00`
    );

    const events = await getEventsForDay(
        startOfDay,
        endOfDay
    );

    const availableSlots = [];

    for (
        let hour = BOOKING_CONFIG.openHour;
        hour < BOOKING_CONFIG.closeHour;
        hour++
    ) {

        const slotStart = new Date(
            `${dateString}T${String(hour).padStart(2, "0")}:00:00+08:00`
        );

        const slotEnd = new Date(
            slotStart.getTime() +
            BOOKING_CONFIG.durationMinutes * 60000
        );

        const conflicts = events.some(event => {

            if (!event.start?.dateTime || !event.end?.dateTime) {
                return false;
            }

            const eventStart = new Date(event.start.dateTime);
            const eventEnd = new Date(event.end.dateTime);

            return (
                slotStart < eventEnd &&
                slotEnd > eventStart
            );
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

        description:
            `WhatsApp customer: +${customerPhone}`,

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
        start.getTime() +
        BOOKING_CONFIG.durationMinutes * 60_000
    );

        const event = {
        id: getSessionCalendarEventId(sessionId),

        summary: "Tea Ceremony Booking Session",

        description:
            `Shared booking session\n` +
            `Session ID: ${sessionId}\n` +
            `Maximum capacity: 10 people`,

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

        // The event may have been created by an earlier attempt.
        const existing = await calendar.events.get({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: event.id
        });

        if (
            existing.data.extendedProperties?.private
                ?.bookingSessionId !== String(sessionId)
        ) {
            throw new Error(
                "Calendar event ID belongs to another session"
            );
        }

        return existing.data;
    }
}
async function hasExternalCalendarConflict({
    bookingDate,
    bookingTime,
    sessionId
}) {
    const start = getSessionStart(bookingDate, bookingTime);

    const end = new Date(
        start.getTime() +
        BOOKING_CONFIG.durationMinutes * 60_000
    );

    const events = await getEventsForDay(
        new Date(`${bookingDate}T00:00:00+08:00`),
        new Date(`${bookingDate}T23:59:59+08:00`)
    );

    return events.some(event => {
        // Ignore the Calendar event belonging to THIS session.
        if (
            sessionId &&
            event.extendedProperties?.private
                ?.bookingSessionId === String(sessionId)
        ) {
            return false;
        }

        // Cancelled and transparent events do not block a slot.
        if (
            event.status === "cancelled" ||
            event.transparency === "transparent"
        ) {
            return false;
        }

        // Timed events.
        if (event.start?.dateTime && event.end?.dateTime) {
            const eventStart = new Date(event.start.dateTime);
            const eventEnd = new Date(event.end.dateTime);

            return start < eventEnd && end > eventStart;
        }

        // All-day events. Their end date is exclusive.
        if (event.start?.date && event.end?.date) {
            const eventStart = new Date(
                `${event.start.date}T00:00:00+08:00`
            );

            const eventEnd = new Date(
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
            summary:
                `Tea Ceremony — ${reservedPlaces}/${capacity} places booked`,
            description:
                `Places booked: ${reservedPlaces}\n` +
                `Places remaining: ${capacity - reservedPlaces}\n` +
                `Total capacity: ${capacity}`
        }
    });

    return data;
}

module.exports = {
    getUpcomingEvents,
    getEventsForDay,
    getAvailableSlots,
    createBookingEvent,
    createSessionEvent,
    hasExternalCalendarConflict,
    updateSessionEventOccupancy
};