# Direct Meta Cloud API: preparation and future cutover

Prepared 2026-10-26. **No transfer is authorized or performed.**

## Verified preparation

- WhatsApp Manager confirms the production account is active, business-verified and connected to 360Dialog.
- Default provider remains 360dialog; main/live production has not been deployed with Meta enabled.
- Production Meta SYSTEM_USER credential is readable locally, valid for the expected app, with both WhatsApp scopes and no scheduled token expiry. Revocation remains possible.
- Production phone +65 80583517 belongs to WABA 1548018376588125; quality GREEN. Phone ID: 1394261800429249.
- Booking Flow 28782493828041844 is PUBLISHED and accessible.
- English/Chinese v3 reminder templates and directions v2 are APPROVED in the current WABA. Recheck assets if the destination WABA changes.
- Public image/PDF/video links returned HTTP 200 with matching content types.
- Test-number inbound, fixed reply and delivered receipts passed on isolated Render staging; this is transport verification, not a live booking test.
- 96 local tests passed, including booking/package/calendar logic, provider routing, HMAC validation, duplicate handling, actual bilingual media/button/Flow/reminder payload parity and credential expiry checks. These use mocks and do not prove Meta will accept every interactive payload live.

## Outstanding gates before an owner-approved cutover

1. Confirm direct Meta billing on the final destination WABA. Do not remove a 360dialog credit line or add/change payment details during preparation.
2. Confirm migration path and whether the existing WABA can be retained. The phone API reports NOT_VERIFIED; do not infer that the current working 360dialog registration is broken or run registration now.
3. Production WABA subscribed_apps GET repeatedly times out. Resolve app access/subscription during coordinated migration; do not subscribe or replace live callbacks now.
4. Confirm whether staff use WhatsApp Business App coexistence. Existing staff handover depends on message echoes; preserving that feature requires a supported coexistence/migration route.
5. Preserve the active host configuration and record a secure backup in the hosting dashboard before any future changes. Production Meta credentials are prepared locally only; do not upload them to the live host until cutover is authorized.
6. Before transferring, approve an isolated full-journey rehearsal using a separate test database/calendar and allowlisted staff/customer recipients. Do not attach staging to production booking/package/calendar writes. Current staging intentionally acknowledges only.
7. Owner must approve the final number move and change window. Confirm control of SMS/voice verification, required PIN handling, provider invoices and support availability. No support messages have been sent.

## Prepared configuration (values belong in secret storage)

Keep these unchanged for now:

```dotenv
WHATSAPP_PROVIDER=360dialog
META_TEST_ENABLED=false
BOOKING_REMINDER_FORMAT=full_v2
```

At a separately approved cutover, production needs META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID, META_APP_SECRET, FACEBOOK_APP_ID, META_GRAPH_API_VERSION and VERIFY_TOKEN, alongside the existing database/calendar/staff settings. Use a production SYSTEM_USER token rather than a temporary test token. Reuse the current database so deduplication, reservations, package balances and reminder checkpoints survive. V3 reminder activation is a separate explicit format choice.

## Future change-window sequence ? do not execute now

1. Capture current host settings and verify the deployment artifact/tests. Run `node scripts/meta-preflight.js` again; review all unverified gates manually.
2. Pause reminder/completion workers and inbound processing in a coordinated change window. The current code has no dedicated global pause switch: use hosting operations under the agreed outage plan; do not invent an environment flag.
3. Follow the confirmed Meta/360dialog migration route. 360dialog documents clearing invoices, disabling number 2FA for migration, triggering migration, then cancelling the subscription after completion. Those are future actions, not preparation steps.
4. Verify final WABA/phone IDs, approved templates, Flow, billing, number registration and app subscription. Set the intended Meta callback and messages subscription only at this point; include message echoes if required and supported.
5. Deploy the reviewed full bot and securely configure the final Meta production credentials. Explicitly switch WHATSAPP_PROVIDER=meta. Never run old and new outbound workers simultaneously.
6. Test one owner-controlled English and Chinese journey: language/menu, FAQ PDFs, directions PDF, video, date Flow and reply, time/party selection, staff handover, confirmation, cancellation, private booking, package debit/refund, calendar event and each reminder part. Use labelled test records and reconcile any real package/calendar changes.
7. Confirm delivery receipts and absence of duplicate messages/bookings. Resume workers and monitor errors, stale claims and reminder checkpoints.
8. Cancel 360dialog only after the migration and production acceptance checks succeed, with explicit owner authorization.

## Recovery

Before the number moves, leave or restore the known 360dialog deployment and settings. After the number moves, changing WHATSAPP_PROVIDER back does not reverse migration. Stop sends, preserve reservation/reminder checkpoints and coordinate provider recovery; inspect ambiguous sends before retrying. Do not replay successful package debits or confirmed bookings.

## References

- [360dialog migration away, including direct Meta](https://docs.360dialog.com/docs/hub/migrations/migrate-to-alternate-bsp)
- [Meta-owned Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Meta webhook setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)

## Coexistence findings (2026-10-26 follow-up)

The owner requires the WhatsApp Business mobile app to keep working. Graph GET
on the production phone confirms is_on_biz_app=true and platform_type=CLOUD_API.
The production WABA is owned by BRT Prototype, approved and business-verified.
Its payment method is a credit line supplied by 360dialog GmbH (Meta Business
Settings, account Summary). Direct Meta billing is therefore not yet established.
Opening detailed payment settings triggered a Meta passkey identity check;
owner completion is required before inspecting those details.

The narrow subscribed_apps read (fields=whatsapp_business_api_data, limit=10)
also timed out. Do not interpret a timeout as proof that no app is subscribed.
The phone-level application callback still points to the existing production
/webhook. No production subscription was modified.

360dialog's coexistence guide explicitly says migration between WABAs is not
supported, and to consult its team before disconnecting the app. Consequently
the generic migration sequence above is NOT an approved procedure for this
number. A same-WABA provider/billing release or supported coexistence re-onboarding
route must be confirmed by Meta/360dialog before any cutover. Do not remove the
current credit line/partner, disable 2FA, deregister, uninstall the app or move
this phone to another WABA during preparation.

Two additional isolated HTTP tests pass against the actual production webhook
route: signed text and Flow replies, duplicate suppression, status-only delivery,
invalid signatures/foreign WABAs, Business App echo handover, and retryable
unfinished processing. This raises the local suite to 98 tests. It does not
replace a full live booking rehearsal with isolated database/calendar resources.

Reference: https://docs.360dialog.com/docs/resources/phone-numbers/coexistence

## Billing inspection after owner identity verification

Owner completed Meta's identity check. The WABA-specific billing page confirms
360dialog GmbH is the DEFAULT credit line, with credit availability shown as High.
No separate direct payment method is listed on that account page. The Add payment
information flow is available and initially shows Singapore, Euro and Singapore
time zone, with a warning that location/currency cannot be changed once set.
The flow was closed before proceeding or saving; no payment information was added
and the existing credit line remains unchanged. Coordinate coexistence/provider
release and billing order before selecting an irreversible billing configuration.

## Full staging work

See FULL-STAGING.md for the created test calendar, isolation launcher/allowlists,
102 passing regressions, monitoring baseline and remaining database/schema/asset
dependencies. The owner reminder review sequence was accepted by 360dialog on
2026-10-26; no booking was created for that preview.
