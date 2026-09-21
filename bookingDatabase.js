const supabase = require("./supabaseClient");

// Temporary development-only drafts.
// These disappear when the server restarts.
// We will replace them with persistent drafts before deployment.
const drafts = new Map();

async function getDraft(customerPhone) {
    return drafts.get(customerPhone) || null;
}

async function startBooking(customerPhone) {
    const draft = {
        customer_phone: customerPhone,
        booking_date: null,
        booking_time: null,
        party_size: null
    };

    drafts.set(customerPhone, draft);
    return draft;
}

async function saveBookingDate(customerPhone, date) {
    const draft = drafts.get(customerPhone);

    if (!draft) {
        throw new Error("Booking draft not found");
    }

    draft.booking_date = date;
    draft.booking_time = null;
    draft.party_size = null;

    return draft;
}

async function saveBookingTime(customerPhone, time) {
    const draft = drafts.get(customerPhone);

    if (!draft || !draft.booking_date) {
        throw new Error("Booking date not selected");
    }

    draft.booking_time = time;
    draft.party_size = null;

    return draft;
}

async function savePartySize(customerPhone, partySize) {
    const draft = drafts.get(customerPhone);

    if (!draft || !draft.booking_date || !draft.booking_time) {
        throw new Error("Booking date or time not selected");
    }

    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) {
        throw new Error("Invalid party size");
    }

    draft.party_size = partySize;

    return draft;
}

async function submitBooking(customerPhone) {
    const draft = drafts.get(customerPhone);

    if (
        !draft ||
        !draft.booking_date ||
        !draft.booking_time ||
        !draft.party_size
    ) {
        throw new Error("Booking details are incomplete");
    }

    // Supabase performs the capacity check and reservation atomically.
    const { data: bookingId, error } = await supabase.rpc(
        "reserve_booking",
        {
            p_customer_phone: customerPhone,
            p_booking_date: draft.booking_date,
            p_booking_time: draft.booking_time,
            p_party_size: draft.party_size
        }
    );

    if (error) {
        throw error;
    }

    const { data: booking, error: fetchError } = await supabase
        .from("booking_requests")
        .select(`
            id,
            customer_phone,
            party_size,
            status,
            session_id,
            booking_sessions (
                booking_date,
                booking_time
            )
        `)
        .eq("id", bookingId)
        .single();

    if (fetchError) {
        // Reservation may already have succeeded. Do not retry
        // reserve_booking automatically or create another booking.
        throw new Error(
            `Booking ${bookingId} was reserved, but could not be fetched: ` +
            fetchError.message
        );
    }

    drafts.delete(customerPhone);

    return {
        ...booking,
        booking_date: booking.booking_sessions.booking_date,
        booking_time: booking.booking_sessions.booking_time
    };
}

async function cancelDraft(customerPhone) {
    return drafts.delete(customerPhone);
}

async function getBookingById(bookingId) {
    const { data, error } = await supabase
        .from("booking_requests")
        .select(`
            id,
            customer_phone,
            party_size,
            status,
            session_id,
            booking_sessions (
                booking_date,
                booking_time
            )
        `)
        .eq("id", bookingId)
        .maybeSingle();

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
    const { data, error } = await supabase
        .from("booking_sessions")
        .select(
            "id, booking_time, capacity, reserved_places"
        )
        .eq("booking_date", bookingDate);

    if (error) {
        throw error;
    }

    return data || [];
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
    const { data, error } = await supabase
        .from("booking_sessions")
        .select(
            "id, booking_date, booking_time, reserved_places, calendar_event_id, calendar_sync_status"
        )
        .gt("reserved_places", 0)
        .or("calendar_sync_status.neq.synced,calendar_event_id.is.null");

    if (error) {
        throw error;
    }

    return data || [];
}

async function getBookingSession(sessionId) {
    const { data, error } = await supabase
        .from("booking_sessions")
        .select(
            "id, capacity, reserved_places, calendar_event_id"
        )
        .eq("id", sessionId)
        .single();

    if (error) {
        throw error;
    }

    return data;
}
module.exports = {
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
    getUnsyncedSessions,
    getBookingSession
};