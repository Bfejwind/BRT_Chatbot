# Isolated full chatbot staging

Prepared 2026-10-26. Production remains 360dialog; no transfer is authorized.

## Ready

- New private Google Calendar: BRT Meta Staging ? Test bookings only, Asia/Singapore.
- Calendar ID: 30e3c053a08375383c770acb9d9ff5604b0330b2659f2151c450855e4c02aa13@group.calendar.google.com.
- Owner approved service-account access for synthetic events. Insert/get/delete verification passed with no attendees; the verification event was cleaned up.
- `scripts/full-staging-server.js` loads ONLY `.env.staging`, clears inherited production settings, and refuses matching production database URL/key, calendar ID, phone ID or WABA ID. It needs local `.env` as a comparison baseline only.
- `stagingIsolation.js` enforces outbound customer/staff allowlisting. The full webhook rejects non-allowlisted incoming customers before claiming or processing bookings. These guards are inactive for normal production.
- `.env.staging` is ignored and contains the new calendar ID with empty credential placeholders. Do not copy production database settings into it.
- 102 local tests pass, including resource isolation, outbound allowlist, incoming staging rejection and read-only monitoring. The existing test-number deployment remains acknowledgment-only until a separate reviewed full-bot deployment is configured.

## Pending live rehearsal dependencies

1. Owner must complete password creation and submit the free BRT Meta Staging Supabase project form. The browser credential rule requires owner entry/submission. No project is confirmed created yet.
2. Export production SCHEMA ONLY, including base booking_requests/booking_sessions tables, RPCs, indexes, triggers, grants and RLS. Repository migrations 001?007 assume some base schema already exists; applying those files alone to a blank project is insufficient. Use a proper schema-only pg_dump with a separately provisioned database administration connection; none is currently available to this workspace. `scripts/schema-audit-readonly.sql` helps inspect metadata but is not a complete backup.
3. Restore that schema into the NEW project and compare metadata. Do not copy customer rows or package balances. Seed only clearly labelled synthetic customers/packages for the allowlisted test number.
4. Supply the new project URL and service-role credential, refreshed Meta TEST token, app secret/verify token and Google service-account JSON directly into ignored `.env.staging` or dedicated host secrets. Never share secrets in chat or commit them. The Google credential may access production, so the launcher requires the distinct test calendar ID and refuses the production calendar.
5. Check the test WABA's own approved templates and published booking Flow. Production-WABA asset IDs cannot be assumed usable by the test number; provision test assets before sending those payloads live.
6. Start locally with `node scripts/full-staging-server.js` only after all checks pass. Host using a SEPARATE free service if available, with its own credentials. The current existing Render test branch contains only the acknowledgment service, not these new full-bot preparations. Do not repoint its callback until the full isolated deployment is reviewed and ready.
7. Do not migrate the production phone, change the live app callback, attach staging to production data/calendar, or enable Meta on the production host.

## Acceptance checklist

Use the test number and allowlisted owner/staff recipient only. Label every record TEST.

- English and Chinese language selection, menus, FAQ PDFs, directions PDF and video.
- Native date Flow, valid/expired/replaced Flow replies, permitted public times/party sizes.
- First public booking, each entitled package category and private staff booking.
- Exactly one package debit and calendar event despite duplicate messages/retries.
- Confirmation/customer/staff messages and cancellation/refund/calendar sync.
- Tomorrow reminders: exact dynamic times, English, Chinese, address and directions PDF in order.
- Interrupted multipart reminder resumes without duplicating accepted parts.
- Business App staff echo pauses automation; greeting recovery works. Real mobile-app coexistence cannot be certified with Meta's synthetic test phone; verify on a supported separate coexistence test account or during the authorized production acceptance window.
- API rejection, timeout, duplicate delivery and stale claim monitoring. Do not blindly replay ambiguous sends.

Record each live result separately from the already passing mocked regressions.

## Monitoring

`node scripts/operations-monitor.js` is READ ONLY. It returns counts (no customer data) for failed/unknown reminders, unknown completion jobs, sends stale over 15 minutes and private calendar syncs pending over 15 minutes. Exit codes: 0 clear, 2 attention, 1 unavailable. It performs no retries, sends or writes. It has been run manually, not installed as an automatic alerting service.

Initial production baseline: four failed public reminder records dated October 3?8 (one invalid token, three WhatsApp 132001); no unknown jobs, stale sending claims or stale private calendar jobs. Do not resend historical reminders. Current owner reminder preview on October 26 was accepted by 360dialog for English v3, Chinese v3 and directions v2 (HTTP 200 each).

Use Render's logs/health monitoring plus a separately configured scheduler to run the aggregate monitor at an agreed interval; alert destinations need owner authorization. Never expose the service-role key in a public health endpoint.

## Recovery and deployment package

Before any future production deployment, save host settings securely, take a recoverable database backup and record the deployed commit. Keep credentials out of source/patches. Include server.js, provider/sender/webhook modules, booking/reminder dependencies, exact package lockfile, migrations and this acceptance checklist in review. Preparation changes are local and not deployed to production.

After an approved cutover, a provider flag alone does not reverse a phone migration. Preserve message/reminder claims and package transactions, stop overlapping workers and coordinate the confirmed coexistence recovery path with Meta/360dialog.

## Resource creation and real database rehearsal results

The owner created free Supabase project BRT Meta Staging, ref zbpngdftvdgqctgfyxsb,
URL https://zbpngdftvdgqctgfyxsb.supabase.co, Northeast Asia (Seoul). Healthy.
A read-only catalog query on the existing database captured structure only:
10 tables, 15 public functions, constraints, non-constraint indexes and triggers.
That structure was restored into the initially empty staging schema in a transaction
that refuses a non-empty destination. All staging tables have RLS enabled, access
revoked from anon/authenticated, and service_role access. No customer records,
package balances, calendar events or storage objects were copied. This catalog
snapshot is a staging initialization artifact, not a full recoverable production
backup: original policies/grants are deliberately replaced with restrictive
service-only staging access, and provider-managed schemas are excluded.

The actual staging database then passed a rolled-back service_role rehearsal:
message claim/completion/deduplication, public reservation idempotency, package
booking with exactly one debit, private booking idempotency and exactly one refund
after repeated cancellation. The test SQL is scripts/staging-db-rehearsal.sql.
All synthetic database writes rolled back. The live Google Calendar synthetic
insert/read/delete test also passed separately.

IMPORTANT existing behavior: reject_booking only rejects pending requests. Current
reserve_booking auto-approves. It cannot cancel an approved public booking or
refund its package use. The initial rehearsal expecting public refunds failed;
the corrected compatibility rehearsal explicitly verifies that limitation instead
of claiming refunds work. Public approved cancellation/refund needs a separately
agreed implementation or staff procedure; migration preparation did not change
production policy. Private cancellation/refunds passed.

Remaining blockers to a connected full-bot run: SUPABASE_SECRET_KEY and a valid
Meta test META_ACCESS_TOKEN are still empty in .env.staging. The test WABA's
published Flow and matching approved reminder templates also need verification
before testing those messages live. No complete phone-to-database-to-calendar
journey has been run, and no automatic monitoring schedule or alert destination
has been deployed. The operations monitor is prepared and was run manually.

Superseded checklist items above: the staging project and schema now exist; the
password/project creation step and schema initialization are complete. The local
launcher is currently intended for local use with a local production comparison
baseline. A hosted full-bot launcher must use sanitized production resource IDs
and a production-key fingerprint, not upload the production .env to staging.

## Hosted deployment preparation follow-up

Hosted launcher support is now implemented: STAGING_ENV_FROM_HOST=true uses host
secrets and STAGING_BASELINE_JSON with production resource IDs plus the production
Supabase key's SHA-256 fingerprint. It does not require uploading production .env.
The local .staging-baseline.json is ignored. The separate Render blueprint is
render.meta-full-staging.yaml; it has not been deployed or pushed. /health is a
liveness endpoint only, not proof of database/calendar/WhatsApp readiness.

104 regression tests pass after local dependency security updates; npm audit
reports zero vulnerabilities. A credential-scanned review ZIP and SHA-256 file
manifest are at .media-work/prepared-artifacts/meta-preparation-review.zip. It is
not a production backup and contains no runtime .env or service-account key file.

Latest reminder status: Chinese v4 approved, English v4 pending. Production's
reminder format has not changed. Production preflight now checks the intended v4
revision by default (META_TARGET_REMINDER_FORMAT may explicitly choose another).

Staging secret key, Meta test token and test Flow ID remain blank. User requested
help locating them; instructions and direct staging API-key link were supplied.
The browser connection timed out twice, so the latest support-case state could
not be inspected. No provider or billing changes were attempted.

## Current verification — 27 October 2026

This section supersedes older missing-key and template-approval notes above.
Both staging credentials are populated. The database credential passes read-only
checks on all 10 restored tables and the bot's native Supabase client. Test-calendar
read access passes and its timezone is Asia/Singapore. Isolation validation passes.
The full bot started locally on port 3200, returned HTTP 200 from /health, and was
stopped after the smoke check. Reminder workers remained disabled for this check.
104 local regression tests pass.

Both production-WABA v4 reminder translations and directions v2 are now APPROVED.
The production booking Flow remains PUBLISHED and the production SYSTEM_USER token
passes validation. No production configuration was changed. The production WABA
subscription read still times out and remains unverified.

The staging Meta token was rejected with 190/463 (expired). A replacement temporary
token was generated in the developer dashboard using the existing permissions.
Saving it through editor automation was unsuccessful; owner was asked to copy it
directly to ignored .env.staging. Test Flow ID is blank. Full staging deployment,
test assets and the connected live booking journey remain incomplete.
Billing/support inspection currently requires the owner's passkey check. The
coexistence-compatible provider-release and direct-billing order remains unconfirmed.

Rerun `node scripts/full-staging-preflight.js` after refreshing the staging token.
This read-only command validates isolation, database access, calendar access, test
phone, subscription, reminder assets and Flow; it writes only a sanitized local
report to meta-full-staging-readiness.json. Exit 2 means checks remain blocked.
A successful health check alone does not certify messaging or booking readiness.
