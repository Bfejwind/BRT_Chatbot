# BRT Render account recovery — 28 October 2026

Destination owner: xcorpedutechvietnam@gmail.com.
Destination workspace: tea-dbgjgfg473hc73cn6aa0.
Replacement service: brt-chatbot-live (srv-dbgkmjm7bikc73afi43g).
URL: https://brt-chatbot-live.onrender.com.
Region: Singapore. Plan: Free, explicitly selected by owner.
Build: npm ci. Start: npm start. Health: /health. Automatic deploys: off.
Source: Bfejwind/BRT_Chatbot, codex/reminder-v5-live.
Final intended commit: 2808fefa57e5115262ec64447925ed8273ce5fc6.

Old service srv-daoum9m0tbcc73foaetg is suspended by billing. Do not resume it
alongside the replacement without coordinating workers and webhook routing.
The Render connector still has access to the old account only; the new account
was verified through its signed-in dashboard.

The replacement retains 360dialog and the existing Supabase database, Google
Calendar, booking Flow, staff number and webhook shared secret. No number or Meta
provider migration is part of this recovery. Owner authorized uploading the
existing production credentials to the replacement service.

Both v5 translations and directions v2 are approved. BOOKING_REMINDER_FORMAT is
full_v5 and BOOKING_REMINDERS_ENABLED is true. Existing accepted reminder claims
and package transactions remain in the original database. Never bulk-replay
historical reminders after the outage.

72 regression tests passed. Database and calendar credentials validated read-only.
New URL health HTTP 200; missing webhook secret HTTP 401; correct secret with an
empty event HTTP 200. These checks do not replace a real WhatsApp inbound/reply test.

Free instances sleep after inactivity; the in-process reminder timer cannot
provide guaranteed punctual reminders while sleeping. Owner chose this plan with
that limitation explained. No paid resources were authorized.

Webhook cutover and final real-phone verification: pending at file creation.
A secret-bearing webhook backup is kept only in ignored
.env.webhook-recovery-backup. Do not print or commit it. An ignored temporary
credential import file must be removed once setup is verified.

## Verified cutover

Final deployment 2808fefa57e5115262ec64447925ed8273ce5fc6 reached Live.
Render logs confirm server port 10000 and the Singapore reminder scheduler started.
360dialog callback changed from https://brt-chatbot.onrender.com/webhook to
https://brt-chatbot-live.onrender.com/webhook. API read-back confirms the new URL
and the existing authentication headers are unchanged. No WhatsApp number move
or switch to direct Meta was performed. Owner real-phone test is pending.

## Owner acceptance

Owner confirmed a fresh Hi to +65 8058 3517 returned the chatbot menu after
cutover. Real inbound-to-reply path is therefore verified on the replacement.
Post-recovery aggregate monitor: four pre-existing failed public reminders,
zero unknown outcomes, zero stale sending jobs and zero stale private calendar
syncs. Historical failed reminders were not resent. No synthetic booking or
package deduction was created for acceptance testing.
