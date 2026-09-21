
const supabase = require("./supabaseClient");

// Find the customer's unfinished draft.
async function getDraft(customerPhone) {
    const { data, error } = await supabase
        .from("booking_requests")
        .select("*")
        .eq("customer_phone", customerPhone)
        .eq("status", "draft")
        .maybeSingle();

    if (error) throw error;

    return data;
}

// Start a fresh booking.
// If a draft already exists, reset it.
async function startBooking(customerPhone) {
    const existing = await getDraft(customerPhone);

    if (existing) {
        const { data, error } = await supabase
            .from("booking_requests")
            .update({
                booking_date: null,
                booking_time: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", existing.id)
            .eq("status", "draft")
            .select()
            .single();

        if (error) throw error;

        return data;
    }

    const { data, error } = await supabase
        .from("booking_requests")
        .insert({
            customer_phone: customerPhone,
            status: "draft"
        })
        .select()
        .single();

    if (error) throw error;

    return data;
}

// Save a selected date and clear any previously
// selected time.
async function saveBookingDate(customerPhone, date) {
    const draft = await getDraft(customerPhone);

    if (!draft) {
        throw new Error("No active booking draft");
    }

    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            booking_date: date,
            booking_time: null,
            updated_at: new Date().toISOString()
        })
        .eq("id", draft.id)
        .eq("status", "draft")
        .select()
        .single();

    if (error) throw error;

    return data;
}

// Save a selected time.
async function saveBookingTime(customerPhone, time) {
    const draft = await getDraft(customerPhone);

    if (!draft?.booking_date) {
        throw new Error("Booking date is missing");
    }

    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            booking_time: time,
            updated_at: new Date().toISOString()
        })
        .eq("id", draft.id)
        .eq("status", "draft")
        .select()
        .single();

    if (error) throw error;

    return data;
}

// Submit the draft for staff approval.
// Only a draft can become pending.
async function submitBooking(customerPhone) {
    const draft = await getDraft(customerPhone);

    if (!draft?.booking_date || !draft?.booking_time) {
        return null;
    }

    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            status: "pending",
            updated_at: new Date().toISOString()
        })
        .eq("id", draft.id)
        .eq("status", "draft")
        .select()
        .maybeSingle();

    if (error) throw error;

    return data;
}

// Cancel only an unfinished draft.
async function cancelDraft(customerPhone) {
    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            status: "cancelled",
            updated_at: new Date().toISOString()
        })
        .eq("customer_phone", customerPhone)
        .eq("status", "draft")
        .select();

    if (error) throw error;

    return data;
}

// Find one specific booking by its unique ID.
async function getBookingById(bookingId) {
    const { data, error } = await supabase
        .from("booking_requests")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

    if (error) throw error;

    return data;
}

// Claim a pending booking for approval.
// Only one concurrent approval can change
// pending -> approving.
async function claimBooking(bookingId) {
    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            status: "approving",
            updated_at: new Date().toISOString()
        })
        .eq("id", bookingId)
        .eq("status", "pending")
        .select()
        .maybeSingle();

    if (error) throw error;

    return data;
}

// Reserve the selected slot in the database.
// The unique constraint prevents another bot
// approval from reserving the same slot.
async function reserveSlot(booking) {
    const { data, error } = await supabase
        .from("booking_slot_reservations")
        .insert({
            booking_id: booking.id,
            booking_date: booking.booking_date,
            booking_time: booking.booking_time
        })
        .select()
        .single();

    if (error) {
        if (error.code === "23505") {
            return null;
        }

        throw error;
    }

    return data;
}

async function releaseSlot(bookingId) {
    const { error } = await supabase
        .from("booking_slot_reservations")
        .delete()
        .eq("booking_id", bookingId);

    if (error) throw error;
}

async function updateBooking(
    bookingId,
    expectedStatus,
    changes
) {
    const { data, error } = await supabase
        .from("booking_requests")
        .update({
            ...changes,
            updated_at: new Date().toISOString()
        })
        .eq("id", bookingId)
        .eq("status", expectedStatus)
        .select()
        .maybeSingle();

    if (error) throw error;

    return data;
}

module.exports = {
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
};