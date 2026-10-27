# Booking reminders

## Full reminders and staff private bookings (October 2026)

October 26 revision: the owner-provided Chinese and revised English templates
are `tea_session_reminder_full_zh_v3` and `tea_session_reminder_full_en_v3`.
After Meta approves both, deploy the updated code with
`BOOKING_REMINDER_FORMAT=full_v3`. The provider can stay `360dialog`; this wording
change does not require moving the number. The address/document template remains
`tea_session_directions_v2`. Until that explicit setting, the v2 wording is used.
The v3 English spacing and wording are saved in `templates/drafts/reminder-preview.md`.

The default reminder format is now `full_v2`: full English reminder, full Chinese
translation, then a document template containing the address and Directions.pdf.
Each timeline follows registration at the booked start, introduction 15 minutes
later, and the session 30 minutes later. Morning/afternoon/evening greetings follow
the registration time. Singapore time applies throughout.

Run `migrations/007_staff_private_bookings.sql` after 006, then deploy/restart the
bot with all new files (`privateBookings.js`, `reminderTemplates.js`, and updated
`calendarService.js`, `bookingReminders.js`, `server.js`). No new secrets are needed.
`BOOKING_REMINDERS_ENABLED=true` is still required. Set `BOOKING_REMINDER_FORMAT=legacy`
only to deliberately retain the previous single-template behavior.

The three definitions in `templates/tea_session_*_v2.json` must be approved.
`node scripts/reminder-templates.js --submit` submits missing definitions through
360dialog; without the flag it only checks their status. This script sends no
customer messages. The scheduler checks approval before claiming any jobs and
waits if approval is pending. Once all three are approved, it proceeds automatically.
Accepted parts are checkpointed in `delivery_parts`, so retrying a rejected later
part does not resend an earlier accepted part. Uncertain outcomes require review.
The document is a template so it works outside the 24-hour customer service window.

The existing staff Package Desk now has a Private bookings form. It saves a
separate approved private booking with consent, date/time and 1–10 guests. Staff
may use an eligible Exclusive/Premium package (one use per booking), use Unlimited
without decrementing its balance, or choose no package deduction. Weekday and
Weekend packages remain public-session packages. Database transactions lock the
selected package and make repeated submissions/cancellations idempotent.

The bot synchronizes new private sessions to Google Calendar every minute using
deterministic event IDs, checking calendar conflicts before insertion. Failed
calendar synchronization stays pending and is visible on the staff site; reminders
are blocked until synchronization succeeds. Cancel through the staff site to
restore a deducted use, suppress reminders and queue calendar deletion. To change
a booking, cancel and re-enter it. Direct Google Calendar additions/edits are not
imported; existing manually entered events must be reconciled before using the form.
Overlapping public/private bookings already present in Supabase are rejected.
Public chatbot bookings stay at 4 PM. Private bookings use their chosen time and
the same previous-day reminder window; same-day bookings get no “tomorrow” message.
The form does not send an immediate WhatsApp confirmation.

The website deployment does not deploy the separate Node chatbot. Its server must
run the updated code for private calendar synchronization and reminder delivery.

## Previous single-template setup

After confirmation, customers can tap **Test reminder** to receive the same
approved reminder template immediately for their own approved booking. This
does not change the booking or consume the scheduled reminder. The
click must reach the bot within 15 minutes of its WhatsApp timestamp. Older
clicks, or clicks with missing/invalid timestamps, are acknowledged silently
to prevent delayed webhook retries from generating unexpected replies.
The button's
message explains that the template's "tomorrow" wording is only a test sample.
The test requires a valid 360dialog key and an approved configured template,
even when the automated scheduler is disabled.

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

   Existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `WHATSAPP_API_KEY`
   (the 360dialog channel key) are also required. The Supabase key must have service-role access.
4. Restart/deploy the server on an always-on host. A sleeping or stopped server
   cannot run the scheduler. No customer messages are sent by the automated tests.

The worker is disabled until explicitly enabled. Ordinary text messages are not
used as a fallback: proactive reminders use an approved WhatsApp template.
Reminders use the same 360dialog send queue as customer replies and staff notifications.
Explicit rate-limit rejections receive up to three immediate retries with backoff;
successful messages and uncertain network failures are not automatically resent by the queue.
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

## Owner revision v4 (2026-10-26)

English now starts "Dear Guests,". Chinese preserves the owner-supplied blank
lines between every reminder bullet and before the closing. New v4 English and
Chinese templates were submitted for approval; directions v2/address/PDF stay
unchanged. Preview: templates/drafts/reminder-preview-v4.md. After approval and
an authorized deployment, use BOOKING_REMINDER_FORMAT=full_v4. Existing v3
checkpointed jobs retain v3. No live provider or production format was changed.
