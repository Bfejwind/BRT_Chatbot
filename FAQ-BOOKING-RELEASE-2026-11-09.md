# FAQ and booking release — 9 November 2026

Deployed through the signed-in Render browser session at 7:37pm Singapore time.

- Service: brt-chatbot-live / srv-dbgkmjm7bikc73afi43g
- Release commit: a75ba50a6e378ec40a31b89e40907bd911c0ed6b
- Release branch: codex/faq-booking-nov09
- Deploy: dep-dbor0dff3r2c73c2hk9g — Live
- Previous live commit: 2808fefa57e5115262ec64447925ed8273ce5fc6

The release was prepared in `.release-nov09` from the previous live commit to avoid deploying unrelated local integration changes. Production pricing, first-trial weekday eligibility, provider configuration and linked service branch were preserved. This release is deployed by explicit commit; the original working checkout remains on main with its local changes.

## Changes

- Replaced chatbot-images/FAQChinese.pdf and FAQ.pdf in Supabase with the supplied Chinese and English PDFs. Public downloads returned HTTP 200, application/pdf, and byte-for-byte matches (9,451,837 and 8,293,813 bytes respectively).
- Added versioned FAQ URLs and matching Chinese/English document display filenames.
- Chinese Things to Note uses 茶荟 and asks guests to arrive 10 - 20 minutes early.
- Public slots: 12:00pm to 1:30pm, 2:00pm to 3:30pm, 4:00pm to 5:30pm, subject to capacity and calendar conflicts.
- User-facing dynamic times use lowercase am/pm without a space.
- Expired booking options automatically restart the booking questions.
- Added the first-time visitor discount explanation before Promotion $68 Public session.
- Applied migrations/008_public_session_times.sql in Supabase. Read-back confirmed that reserve_booking_with_completion and reserve_package_booking accept all three start times. Existing validation, locking and privileges are preserved; reserve_booking has no fixed-time restriction and booking_sessions has no fixed-time constraint.

## Verification

- 77 production-release regression tests passed; JavaScript syntax check passed.
- Render logs confirm the release SHA, successful build, server start and Live status.
- GET /health: 200.
- Unsigned empty POST /webhook: 401.
- Authenticated empty POST /webhook: 200.
- Read-only Supabase request using local configuration succeeded.
- No synthetic customer messages or bookings were created.

A startup reminder request received PGRST303, JWT issued at future, at 7:37:07pm. This did not recur in the subsequent logs reviewed. Health and empty webhook checks do not establish end-to-end WhatsApp delivery. A real customer chat test remains necessary, particularly given the earlier provider-network incident recorded in CONNECTION-INCIDENT-2026-11-04.md.
