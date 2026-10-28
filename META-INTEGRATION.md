# Direct Meta integration preparation

The active provider remains **360dialog** unless `WHATSAPP_PROVIDER=meta` is
explicitly set. Preparing Meta test credentials does not change that setting.
Do not change the live number, existing 360dialog webhook, registration, 2FA,
billing or subscription during this preparation.

## Implemented

- `whatsappProvider.js` routes the existing chatbot payloads to either 360dialog
  or `https://graph.facebook.com/{version}/{phone_number_id}/messages`.
  Meta requests contain a Bearer token, never a 360dialog API key. A Meta failure
  never falls back to another sender/number. The existing pacing/retry queue stays.
- The existing `/webhook` keeps its 360dialog secret check by default. Only an
  explicit production provider switch enables Meta raw-body HMAC-SHA256 checks.
  Meta deliveries must match the configured WABA and receiving phone number ID.
- Reminder template readiness uses the selected provider's API. Meta template
  lists are paginated using cursors on a fixed Graph API URL.
- `/meta-test/webhook` is a separate, disabled-by-default test endpoint. It
  accepts only the configured test WABA/phone and allowlisted test customers.
  It sends a fixed connection acknowledgment and never calls booking/package/
  calendar handlers. Delivery receipts are acknowledged without another reply.
  Duplicate message IDs are suppressed in memory for this test endpoint only;
  a restart clears that test cache. Production retains durable deduplication.

## Test credentials

Use Meta's **test** phone number, not the live +65 80583517 number. Add the following
to the ignored local `.env` (see `.env.example`); never paste tokens in chat:

```dotenv
WHATSAPP_PROVIDER=360dialog
META_GRAPH_API_VERSION=v26.0
META_TEST_ENABLED=false
META_TEST_ACCESS_TOKEN=...
META_TEST_PHONE_NUMBER_ID=...
META_TEST_WABA_ID=...
META_TEST_VERIFY_TOKEN=...
META_TEST_RECIPIENTS=6582064900
```

The existing `FACEBOOK_APP_ID` and `META_APP_SECRET` identify the approved app.
Temporary test tokens expire; these are not production credentials.

Run `node scripts/meta-readiness.js` for read-only checks of token/asset access,
number ownership and WABA app subscription. It makes no registration/subscription
changes and sends no messages. `--production` checks production Meta credentials
without activating them. Missing tokens must be provided before live API testing.

To test incoming webhooks, use a separate deployed test instance or staging URL
with `META_TEST_ENABLED=true`, preserving the live app/number's callback and
360dialog service. The endpoint is `/meta-test/webhook`; use
`META_TEST_VERIFY_TOKEN`. It needs a reachable HTTPS host and the Meta test WABA's
app subscription. Do not redirect the live business number to this endpoint.
No test instance or public tunnel is created automatically by these code changes.

The automated HTTP integration tests use a local mock Meta server. They exercise
the real Express test endpoint, request headers, signature/account validation,
duplicates, receipts and queued sending without external customer messages.

## Future production cutover — not performed

1. Obtain and securely configure production `META_ACCESS_TOKEN`,
   `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_APP_SECRET` and supported version.
2. Verify asset permissions, direct billing, phone migration requirements and
   WABA subscription to the app. Coordinate 360dialog migration separately.
3. Verify the full reminder templates and booking Flow belong to/are accessible
   through the destination WABA. Check the Meta `smb_message_echoes` subscription
   if staff handover relies on Business App coexistence.
4. Pause scheduled workers during cutover, deploy the tested code, explicitly set
   `WHATSAPP_PROVIDER=meta`, and configure Meta's callback to the production
   `/webhook`. Restart and verify inbound/outbound messaging and status receipts.
5. Resume workers after checks. Avoid overlapping old and new senders. Reverting
   the provider flag alone does not reverse a completed number migration.

`/connect-whatsapp` now explains that connections are staff-managed, and
`/whatsapp-signup/exchange` returns 501 without exchanging codes. This replaces
the scaffold's misleading success response. A direct connection for this single
business uses securely configured credentials above.
Self-service customer onboarding additionally needs authenticated user binding,
code/state validation, verified asset grants, encrypted token storage, registration
where applicable, WABA subscriptions, revocation and per-business isolation.
Multi-business self-service onboarding remains separate from this single-business cutover.

## Preparation verified October 26, 2026

- The owner confirmed receipt of the standard `hello_world` template sent from
  Meta test number +1 (555) 196-1602 to +65 8206 4900.
- An existing SYSTEM_USER token was validated for the correct app, both WhatsApp
  permissions and no scheduled expiry (`expires_at=0`). It can still be revoked.
  Canonical production Meta credentials/IDs are prepared only in the ignored local
  `.env`; `WHATSAPP_PROVIDER` remains 360dialog and Meta test webhooks stay disabled.
- Production number +65 80583517 is readable and GREEN, and belongs to WABA
  1548018376588125. Meta reports `code_verification_status=NOT_VERIFIED`; this must
  be reviewed as part of the number/coexistence migration, not changed now.
- The existing published booking Flow is accessible through the token.
- Both v3 reminder templates and the existing directions template are APPROVED.
  Their stored message bodies match the owner-supplied wording/spacing.
- App-level webhooks are active at `https://brt-chatbot.onrender.com/webhook` with
  the `messages` field. The production WABA's `subscribed_apps` read timed out;
  app-level subscription alone does not prove WABA-level routing is ready.

`node scripts/meta-preflight.js` performs all available read-only production API
checks and explicitly leaves billing, registration/migration and real inbound
HTTPS delivery unverified. It never subscribes/registers/migrates or sends.

`scripts/meta-test-server.js` is a standalone staging server with no Supabase,
Google Calendar or booking jobs. `render.meta-staging.yaml` is a separate service
blueprint with auto-deploy disabled and no secret values committed.

The owner authorized a separate Free Render staging service and entered its
secrets directly. The service is deployed at `https://brt-meta-test.onrender.com`
(Render service `srv-dbfce1ks728c73et8690`, branch `codex/meta-staging`). Its health,
GET verification challenge, valid signed empty POST, unsigned rejection (401),
and wrong-WABA rejection (403) were verified against the live HTTPS endpoint.
Only the test WABA 1011343481959468 has a callback override to
`https://brt-meta-test.onrender.com/meta-test/webhook`. Meta confirmed the override,
and the app-wide callback remained `https://brt-chatbot.onrender.com/webhook`.
The production number, 360dialog routing and main branch were not changed.

For the real inbound check, send `Hi` from +65 8206 4900 to +1 555 196-1602.
The isolated service replies with its test acknowledgment and logs delivery
receipts without booking/package/calendar mutations. On October 26, 2026 at
12:14 PM Singapore time, a real customer Hi triggered the acknowledgment; the
owner confirmed phone receipt and Render logged sent and delivered statuses.
This verifies the isolated transport, not production booking flows or cutover.
Render Free may sleep when inactive, delaying the first request.

The initial staging build flagged four transitive dependency advisories. Only
the staging branch lockfile was patched (`4b99c76`); `npm audit` then reported
zero findings and all 14 staging webhook/provider/sender regression tests passed.
The production/main lockfile was not changed by this isolated deployment.

`node scripts/meta-test-webhook-setup.js --configure` re-applies only this test
override after checking that the WABA is already subscribed, staging answers its
challenge and the app-wide callback is unchanged. Its tests refuse production IDs.

## Revised reminder templates

The owner-supplied Chinese copy and revised English are in `reminderDraft.js`, with
review files under `templates/drafts/`. Both v3 templates were submitted for Meta
approval on October 26, 2026. The exact user spacing is retained in their template
bodies. Timeline variables remain dynamic (start, +15, +30 minutes); the afternoon
closing changes for morning/evening private bookings. The existing directions
document template, PDF URL and address are unchanged.

After all three templates are approved, set `BOOKING_REMINDER_FORMAT=full_v3` on
the bot host and restart/deploy the updated code to activate the revision while
remaining on `WHATSAPP_PROVIDER=360dialog`. Until that explicit format change, v2
remains selected. Multipart v3 jobs retain their revision across later format
changes. `node scripts/reminder-templates.js --draft-zh` and `--draft-en` check
the respective revised template status; add `--submit` only after owner approval.

References: [Meta Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api),
[Meta webhook endpoint documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint).

## Test credential refresh verification (October 26, 2026)

The original temporary token returned 131005 on text sends and later expired.
After the owner replaced the staging token, staging was redeployed at 12:01 PM
Singapore time; its phone-access probe returned HTTP 200 for the expected test
number. The live inbound/reply test then passed at 12:14 PM, including delivery
receipts. The local .env test token was still expired when checked at noon and
needs the same replacement before local API diagnostics can run. Temporary
test credentials are not a production credential plan. Production remains on
360dialog; no production number migration or callback change was performed.

## Preparation follow-up (2026-10-26)

See [META-CUTOVER-RUNBOOK.md](META-CUTOVER-RUNBOOK.md) for verified assets,
remaining gates, future owner-approved change-window checks and recovery steps.
96 local regression tests passed, including actual bilingual chatbot payloads
through the Meta transport builder. The production preflight now rejects
temporary user tokens and expired token/data-access timestamps; it explicitly
reports productionCutoverReady=false until the manual gates are resolved.
WhatsApp Manager confirms this production account is active, business-verified
and integrated with 360Dialog. No production routing/configuration was changed.
