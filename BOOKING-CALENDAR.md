# Calendar date selection

Before each calendar is sent, the server loads session capacity and Google
Calendar events for the three-month window. Dates with no available sessions
are excluded alongside holidays; the Flow's `unavailable-dates` binding makes
those dates unselectable. The fallback list also omits them. Availability can
change after opening a calendar, so time selection and reservation recheck it.
If the published Flow does not contain the `unavailable-dates` binding, publish
the supplied JSON as a new Flow and configure its ID before deploying.

Singapore public holidays and substitute Mondays in MOM's 2026 and 2027 lists
are closed to booking. Dates are checked again before saving and reserving.
Maintain the lists in `bookingSchedule.js` when MOM announces later years or
additional holidays; years without a verified list remain closed.
Sources: [2026](https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026)
and [2027](https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027).

The updated Flow JSON includes `unavailable_dates` to disable holidays in the
calendar. Publish a new Flow with `flows/booking-date.json`, then update
`WHATSAPP_BOOKING_DATE_FLOW_ID` locally and on the host before deploying this
version. An older published Flow does not have the new screen data field.

Customers tap **Choose date**, browse the calendar inside WhatsApp, select a day,
and tap **Continue** once. Calendar navigation does not send chat messages.
The final submission returns to the chat and shows the three available session
times. Selecting a date does not itself reserve any places.

## One-time setup

1. Open [WhatsApp Manager](https://business.facebook.com/wa/manage/) and select
   the WhatsApp Business Account used by this bot.
2. Open **Account tools → Flows** (or **Flows** in the sidebar), then **Create flow**.
3. Name it `tea_booking_date`, choose the appointment-booking category if asked,
   and open the Flow JSON editor. Replace the example with `flows/booking-date.json`.
4. Save and use Meta's preview/validation. Publish the Flow and copy its **Flow ID**.
   This is a client-side Flow: it needs no data-exchange endpoint or encryption key.
5. Add this to `.env` and your hosting environment, replacing the placeholder:

   ```dotenv
   WHATSAPP_BOOKING_DATE_FLOW_ID=YOUR_PUBLISHED_FLOW_ID
   ```

6. Restart the bot. Start a new booking and tap **Choose date** to verify the live
   experience on your phone. Menu names may vary across Meta accounts.

The JSON example dates are only for the editor preview. The server passes fresh
limits for tomorrow through three calendar months ahead in Singapore time, along
with English or Chinese labels. Availability is checked after date submission.

Until a published Flow ID is configured, the existing paginated list remains
available so deployment does not prevent customers from booking. Once configured,
even clicks on old Next/Previous messages open the new calendar prompt.

Each calendar is linked to the customer's current booking draft and expires in
30 minutes. Starting another booking invalidates the old calendar. Drafts remain
in memory, as in the existing bot, so restarting the server requires starting a
new booking. No changes to database tables or reminder templates are needed.

The Flow JSON still needs validation and publication in your Meta account; local
tests cover payloads and reply handling, not WhatsApp's UI renderer.

References: [Meta Flows tools](https://github.com/WhatsApp/WhatsApp-Flows-Tools),
[Meta's Flow messaging example](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-071cfa60-0704-41d2-bca2-36ba6bd33dfe).
