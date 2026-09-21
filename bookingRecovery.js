
require("dotenv").config();

const {
    getUnsyncedSessions,
    markSessionCalendarSynced,
    getBookingSession
} = require("./bookingDatabase");

const {
    createSessionEvent,
    hasExternalCalendarConflict,
    updateSessionEventOccupancy
} = require("./calendarService");

async function recoverBookingSessions() {
    const sessions = await getUnsyncedSessions();

    console.log(
        `Found ${sessions.length} unsynchronized session(s).`
    );

    let recovered = 0;
    let failed = 0;

    for (const session of sessions) {
        try {
            console.log(
                `Checking session ${session.id}...`
            );

            // Do not create an event if another Calendar
            // event currently blocks this session.
            const hasConflict =
                await hasExternalCalendarConflict({
                    bookingDate: session.booking_date,
                    bookingTime: session.booking_time,
                    sessionId: session.id
                });

            if (hasConflict) {
                console.error(
                    `Session ${session.id}: Calendar conflict. ` +
                    `Manual review required.`
                );

                failed++;
                continue;
            }

            // Uses the deterministic event ID added in Step 7.
            // If the event already exists, createSessionEvent()
            // retrieves it instead of creating another.
            const calendarEvent = await createSessionEvent({
                sessionId: session.id,
                bookingDate: session.booking_date,
                bookingTime: session.booking_time
            });

            // Record successful synchronization in Supabase.
            await markSessionCalendarSynced(
                session.id,
                calendarEvent.id
            );
            const latestSession = await getBookingSession(session.id);

            await updateSessionEventOccupancy({
                calendarEventId: calendarEvent.id,
                reservedPlaces: latestSession.reserved_places,
                capacity: latestSession.capacity
            });

            console.log(
                `Session ${session.id}: synchronized.`
            );

            recovered++;

        } catch (error) {
            console.error(
                `Session ${session.id}: recovery failed.`,
                error
            );

            failed++;
        }
    }

    console.log(
        `Recovery complete. Recovered: ${recovered}, ` +
        `Failed: ${failed}.`
    );

    if (failed > 0) {
        process.exitCode = 1;
    }
}

recoverBookingSessions().catch(error => {
    console.error("Recovery could not start:", error);
    process.exitCode = 1;
});