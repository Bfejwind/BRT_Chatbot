# Booking reminders

The server checks once per minute and on startup for approved bookings with a
synchronized calendar session. Reminders go to `booking_requests.customer_phone`
24 hours before the session, using Singapore time. For example, an October 2,
4 PM session gets its reminder on October 1 at approximately 4 PM.

Both English and Chinese are included in one message. Registration starts at the
booked time, and introduction/seating starts 15 minutes later. The bot does not
collect customer names, so the greeting is "Dear Guest" rather than "Dear Jannalyn".

## Activate

1. Run `migrations/001_booking_reminders.sql` in your project's Supabase SQL editor.
   This creates a separate tracking table and a service-role-only claiming function.
2. Submit the BODY text in `templates/booking_reminder.json` in WhatsApp Manager
   as a **Utility** template named `tea_session_reminder`, language **English (US)**
   (`en_US`). The JSON also contains the six positional variable samples. Its body
   deliberately includes both languages. Wait for Meta to approve it; if Meta
   requires changes, update the definition while preserving the parameter order.
   The file is a submission definition, not a template already created in Meta.
3. Add these environment variables locally and on the deployed server:

   ```dotenv
   BOOKING_REMINDERS_ENABLED=true
   WHATSAPP_REMINDER_TEMPLATE=tea_session_reminder
   WHATSAPP_REMINDER_LANGUAGE=en_US
   ```

   Existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PHONE_NUMBER_ID`, and
   `WHATSAPP_TOKEN` are also required. The Supabase key must have service-role access.
4. Restart/deploy the server on an always-on host. A sleeping or stopped server
   cannot run the scheduler. No customer messages are sent by the automated tests.

The worker is disabled until explicitly enabled. Ordinary text messages are not
used as a fallback: proactive reminders use an approved WhatsApp template.
See [Meta's template sending reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).

## Timing and recovery

- A late booking or restart after the due time is picked up if the session is still
  tomorrow in Singapore. Same-day catch-up is intentionally skipped because the
  reminder text says "tomorrow".
- Canceled, rejected, pending, and unsynchronized bookings are not selected.
  Each booking is checked again before sending, including its current session/date/time.
- Database claims prevent multiple app instances from sending the same reminder.
  Changed sessions/date/time can receive a new reminder for the new appointment.
- `accepted` means WhatsApp returned a message ID; it does not prove delivery to the
  customer's device. Delivery receipts are not tracked by this worker.
- Explicit WhatsApp 4xx API rejections are retried after 15 minutes, up to three
  attempts, while the session is still tomorrow. Correct configuration errors
  before retrying exhausted jobs.
- Timeouts, missing message IDs, and ambiguous API failures are marked `unknown`
  and are not resent automatically. A crash or database failure during a send
  can leave `sending`. Review those rows and the WhatsApp logs before resetting
  anything: the message may already have been accepted. This favors avoiding a
  duplicate over blindly retrying an uncertain outcome.

To disable reminders, set `BOOKING_REMINDERS_ENABLED=false` and restart.
To run the isolated tests: `node --test tests/bookingReminders.test.js`.
