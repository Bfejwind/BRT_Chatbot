const supabase = require("./supabaseClient");
const BOOKING_CONFIG = require("./bookingSchedule");

async function getDraft(customerPhone) {
    const { data, error } = await supabase.from('booking_drafts').select('draft').eq('customer_phone', customerPhone).maybeSingle();
    if (error) throw error;
    return data?.draft || null;
}
async function saveDraft(draft) {
    const { error } = await supabase.from('booking_drafts').upsert({customer_phone:draft.customer_phone,draft,updated_at:new Date().toISOString()});
    if (error) throw error;
    return draft;
}
async function startBooking(customerPhone) {
    return saveDraft({customer_phone:customerPhone, booking_date:null, booking_time:null, party_size:null, package_request_id:require('node:crypto').randomUUID()});
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

    if (draft.reserved_booking_id) throw new Error('Booking already reserved; start a new booking to change details');
    draft.package_request_id = require('node:crypto').randomUUID();
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

    if (draft.reserved_booking_id) throw new Error('Booking already reserved; start a new booking to change details');
    draft.package_request_id = require('node:crypto').randomUUID();
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

    if (draft.reserved_booking_id) throw new Error('Booking already reserved; start a new booking to change details');
    draft.package_request_id = require('node:crypto').randomUUID();
    draft.party_size = partySize;

    return saveDraft(draft);
}

async function submitBooking(customerPhone) {
    const draft = await getDraft(customerPhone);

    if (
        !draft ||
        !draft.booking_date ||
        !draft.booking_time ||
        !draft.party_size
    ) {
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
        draft.package_request_id = require('node:crypto').randomUUID();
        await saveDraft(draft);
    }
    const { data: bookingId, error } = await supabase.rpc('reserve_booking_with_completion', {
        p_customer_phone:customerPhone, p_booking_date:draft.booking_date,
        p_booking_time:draft.booking_time, p_party_size:draft.party_size,
        p_booking_route:draft.booking_route, p_request_id:draft.package_request_id,
        p_language:draft.language || 'en'
    });

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

    draft.reserved_booking_id = bookingId;
    await saveDraft(draft);

    return {
        ...booking,
        booking_date: booking.booking_sessions.booking_date,
        booking_time: booking.booking_sessions.booking_time
    };
}

async function cancelDraft(customerPhone) {
    const { error } = await supabase.from('booking_drafts').delete().eq('customer_phone',customerPhone);
    if (error) throw error;
    return true;
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
async function getSessionAvailabilityRange(firstDate, lastDate) {
    const rows = [];
    // Page explicitly: Supabase commonly caps a response at 1,000 rows.
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from("booking_sessions")
            .select("id, booking_date, booking_time, capacity, reserved_places")
            .gte("booking_date", firstDate).lte("booking_date", lastDate)
            .order("id").range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
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
