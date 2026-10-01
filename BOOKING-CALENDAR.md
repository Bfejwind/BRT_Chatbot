# Calendar date selection

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
limits for tomorrow through one calendar month ahead in Singapore time, along
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
