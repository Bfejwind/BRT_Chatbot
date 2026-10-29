# Production v6 release — 28 October 2026

Live at 16:36 Singapore time on brt-chatbot-live, using 360dialog.

- Commit: b313c4f7ae4118e378864c7ae0ed80d3c49734d4
- Deploy: dep-dbgr7kon74is73d7fn7g
- Service: srv-dbgkmjm7bikc73afi43g
- Reminder setting saved and read back: BOOKING_REMINDER_FORMAT=full_v6
- Render confirms Live; the reminder scheduler started.
- Health 200, authenticated 360dialog empty webhook 200, unsigned webhook 401.
- Meta test endpoint disabled; no number migration or callback change occurred.
- Approved English/Chinese v6 and directions template bodies match reviewed copy.
- No production customer messages or bookings were created by smoke checks.
- Job baseline unchanged: four historical failed public reminders, zero unknown
  jobs, zero stale sends. Historical failures were not replayed.

All requested booking lead-time, restart, welcome, staff-hours, policy and reminder
copy changes are included. Existing in-flight reminders retain their saved format.

Rollback: commit 2808fefa57e5115262ec64447925ed8273ce5fc6 and reminder format full_v5.
Render retains its existing codex/reminder-v5-live branch and manual deployment
setting. Use the recorded specific release commit when redeploying; the older
branch tip does not represent this release.

Evidence: production-release-v6.json, production-v6-smoke-check.json and
production-v6-job-check.json.
