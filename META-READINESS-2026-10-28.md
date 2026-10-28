# Meta readiness — 28 October 2026

Production remains on 360dialog. No live number move, billing change, partner
release or production webhook change was performed in this preparation.

## Verified

- Render browser access restored to the account containing brt-chatbot-live.
- Live deploy: 2808fefa57e5115262ec64447925ed8273ce5fc6, service
  srv-dbgkmjm7bikc73afi43g; production /health returned HTTP 200.
- Runtime logs show completed inbound messages, outbound replies and duplicate
  suppression on the existing 360dialog service.
- Production Meta token, phone ownership/quality and published booking Flow pass
  fresh read-only checks. Production app-subscription GET still times out.
- Owner refreshed the isolated test token. All seven staging preflight checks
  pass: phone, subscription, published Flow, templates v4, calendar, database
  tables, native database client. These are access checks, not a live rehearsal.
- 108 local regression tests pass.
- Today's revised reminder wording is packaged as full_v6 with new template
  names, preserving v5 templates and queued reminder checkpoints. Production
  English and Chinese v6 templates were submitted through 360dialog and read
  back as approved. Test-WABA copies were submitted and remain pending at the
  latest check. No reminder format was switched on the live host.

## Hosted rehearsal recovery

The previous brt-meta-full-staging service returns HTTP 503. Render reports
service srv-dbg1heijnfac73f08340 suspended for billing in the old account.
The owner approved a Free replacement, brt-meta-rehearsal, in the account opened
in the browser, and uploading the existing isolated staging credentials.
The replacement uses codex/meta-full-staging, npm ci, and
node scripts/full-staging-server.js. Its form is prepared with isolated
credentials, a sanitized production-resource baseline and reminders disabled.
Deployment and webhook acceptance remain to be verified. This source branch
predates today's local copy/booking changes; deploy the reviewed changes to
staging before claiming they have passed hosted acceptance.

## Remaining production gates

1. Restore the hosted rehearsal, verify signatures/allowlists and perform a
   controlled bilingual booking/reminder journey with test resources.
2. Obtain account-specific coexistence migration, billing and return procedures
   from Meta/360dialog. Follow-up text is in META-SUPPORT-REQUEST.md, not sent.
3. Resolve production app subscription and Business App message echoes.
4. Complete the previously recorded credential rotation with every consumer
   updated; no rotation has been performed or certified here.
5. Capture current hosting configuration before an approved cutover window.

Changing WHATSAPP_PROVIDER back to 360dialog does not reverse number migration.
Do not run old and new outbound workers concurrently or replay accepted jobs.
