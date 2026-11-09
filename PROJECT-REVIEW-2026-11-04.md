# Chatbot project review — 4 November 2026

## Conclusion

The confirmed immediate blocker remains the production Render service's inability to establish a TCP connection to 360dialog. No second confirmed cause of the greeting failure was found. The code contains reliability issues that amplify slow or failed outbound requests. No application code, credentials, database rows, or production settings were changed during this review.

## Findings, ordered by impact

1. **Confirmed production network failure.** The prior production diagnostic deployment tested Axios, forced IPv4, and native HTTPS. All failed before TLS to waba-v2.360dialog.io / 34.116.153.98:443. This is independent of the language-menu payload. See CONNECTION-INCIDENT-2026-11-04.md. Support has been contacted. Do not rotate keys to address a pre-authentication connection failure.

2. **Webhook response waits for database work and outbound delivery.** server.js:2086–2247 claims the message, restores its draft, sends replies, marks completion, and only then acknowledges the webhook. 360dialog documents a five-second acknowledgment limit (https://docs.360dialog.com/docs/messaging/webhook). The sender deliberately waits 6.5 seconds between messages to the same recipient, so multi-message flows can exceed this even when the API is healthy. During the outage, a 30-second outbound timeout guarantees delayed acknowledgment. Retry requests then see the claim as busy and receive 503. This explains repeated 'Message already being processed' logs; those entries alone do not prove a permanently stuck claim. A durable inbox with prompt acknowledgment and independently claimed processing is the appropriate structural fix. Simply responding 200 before persisting work risks losing messages on restart.

3. **Replies and reminders share a single unbounded, in-memory serial queue.** whatsappSender.js:6 and :47–48. One stalled request delays every recipient and any reminders behind it. Rate-limit backoffs also hold the queue. The 30-second request timeout starts when a queued request is actually submitted, so total webhook latency can substantially exceed 30 seconds. The queue disappears on restart. Prefer persisted work, queue-age visibility, and a scheduling policy that keeps interactive replies responsive while preserving provider limits. Do not add blind retries of ambiguous sends.

4. **Webhook retries can replay partially completed replies.** server.js:2220 releases the message claim after any handler failure. A handler may already have sent one or more messages before a later operation fails. The subsequent webhook attempt reruns the whole handler; an outbound timeout can also leave delivery uncertain. Message-level deduplication alone does not checkpoint individual reply parts. Reminder jobs already use more conservative partial-delivery tracking; ordinary chatbot replies need equivalent care. No duplicate customer messages were intentionally generated during review.

5. **Production and the current checkout differ.** The dashboard was verified running 2808fef from codex/reminder-v5-live. The reviewed local checkout is 238f0c3. Auto-deploy is off. Local changes and passing local tests therefore do not establish the behavior of the currently deployed version. Restore the intended source version through a deliberate reviewed deployment after inspecting its compatibility; avoid deploying all recent changes merely to troubleshoot a network fault.

6. **The health endpoint checks only the HTTP process.** server.js:198 returns status=ok without checking outbound WhatsApp delivery or dependencies. It remains green during this incident. Keep liveness fast, but add separate bounded, authenticated operational diagnostics or monitoring so HTTP health is not mistaken for end-to-end chatbot health. Avoid making a provider outage create endless application restarts.

7. **Greeting delivery depends on the database.** server.js:2122 and :2174 run message claims and draft lookup before replying. A database credential, schema, or latency failure can therefore prevent even 'hi' from responding. This is a possible future failure, not a currently observed one: the required live tables are readable and the RPCs are exposed with the local credentials. RPC bodies and claim-lease behavior were not fetched or executed by this review.

8. **Reproduction and automated checks have gaps.** package.json still has the default failing npm test script. The 110 existing tests pass when explicitly invoked, but they do not prove production connectivity. The three message-deduplication RPC definitions are absent from the checked-in migrations, although those functions exist in the live database. A fresh database cannot be reliably reconstructed from this repository alone. The Render runtime observed during diagnosis is Node 24.22.1; local tests ran on Node 20.19.6, and package.json does not pin the runtime. Align and test a supported runtime deliberately.

9. **Free-service sleep affects availability and timers.** The dashboard identifies the production instance as Free. Idle sleep can delay the first reply, and in-process reminder timers cannot run while the service is asleep. This does not explain the observed pre-TLS failures while the process is active. A hosting/worker arrangement with continuous execution is needed if punctual reminders are required. No paid upgrade or hosting move was performed.

## Verification

- Ran all existing tests with PowerShell-expanded test filenames: **110 passed**, exit code 0. The first wildcard invocation failed because this local Node version did not expand the wildcard; the explicit-file invocation succeeded.
- Read-only live database checks succeeded for booking_drafts, bookings, booking_sessions, customer_packages, booking_reminders, staff_private_bookings, staff_private_reminders, and booking_completion_jobs.
- The live REST schema exposes claim_whatsapp_message, complete_whatsapp_message, release_whatsapp_message, reserve_package_booking, claim_booking_completion, claim_booking_reminder, and claim_staff_private_reminder. Presence is not a full behavioral test, and no claims or bookings were created.
- Google Calendar read access succeeded using the application's actual credential selection (GOOGLE_CREDENTIALS_JSON when present, otherwise google-service-account.json). An initial check that required only the environment JSON did not exercise that fallback; it was corrected.
- All seven configured Supabase media links returned HTTP 200 with expected image, PDF, or MP4 content types. The introduction video is 7,296,755 bytes. Reachability from this workstation does not guarantee provider-side media fetching, but no broken link was found.
- Aggregate job monitor at 17:46 Singapore time: four failed public reminders (also documented before this outage), zero unknown public/private reminders, zero unknown booking completions, zero sending jobs older than 15 minutes, and zero approved private bookings with stale pending calendar sync.
- No .env or google-service-account.json is currently tracked. Historical secret exposure across all Git history was not exhaustively audited.

## Practical next steps

First resolve the verified Render-to-360dialog network failure with support and verify one real inbound greeting/reply. Then address durable webhook processing and reply-part checkpoints together, with concurrency/restart/failure tests. Align the deployed commit, runtime, and database bootstrap with the reviewed source. Review the four pre-existing failed reminders individually; do not bulk replay them.

Live database, Calendar, and media checks above used the workstation's configuration. They do not validate Render's Calendar credentials or every Render environment variable. The earlier dashboard investigation verified the production 360dialog key match, provider, endpoint, and webhook authentication.
