# BRT direct Meta integration check — 29 October 2026

Scope: BRT's own chatbot and business number. Customer onboarding and Embedded
Signup implementation are outside this scope.

## Verified in the owner's signed-in Chrome session

- BRT Prototype app 2157340598183627 is Published.
- Dashboard has no required action items.
- Review > Verification: business portfolio 2823279941398827 is Verified.
- Review > App Review: submission dated 6 October 2026 at 18:20 GMT+8 was approved;
  whatsapp_business_messaging, whatsapp_business_management and public_profile
  are all listed as Approved.
- WhatsApp use-case Overview offers Integrate with API for a business using its
  own business phone number and tools. This is the applicable route for BRT.
- Production setup lists Configure Webhooks, Register your WhatsApp phone number,
  Add payment to send business-initiated messages, and Send message. These cards
  alone do not prove that the existing number needs registration again.
- Expanded Configure Webhooks: app-level callback is
  https://brt-chatbot.onrender.com/webhook (older host, not brt-chatbot-live).
- App-level messages webhook field is Subscribed at v26.0.
- App-level smb_message_echoes webhook field is Unsubscribed at v26.0.
  Field subscription is separate from production messaging-account app subscription.
- Opening the linked Billing Hub triggers Meta passkey identity verification.
  Owner handoff requested; no authentication dialog was operated.
- Owner completed identity verification. Production billing account detail still
  lists 360dialog GmbH as its Default credit line with High available credit.
- Business Support Home > View details: case 1104791312160964 is Closed;
  the latest Meta AI case summary states Resolution: Closed automatically,
  last updated one day ago. No specialist migration/rollback procedure was shown.
- Prepared a reopening/escalation reply in META-SUPPORT-REOPEN-2026-10-29.md;
  owner approved and it was sent through the Meta support assistant. The assistant
  acknowledged it would reopen and route the case to a WhatsApp specialist.
  The case card/list still show Closed/Completed; actual reopening and assignment
  remain unverified. The complete request appears in the conversation.

## Still to resolve

### Pre-billing preparation in progress

Owner requests retaining +65 8058 3517 and WhatsApp Business mobile-app messaging,
and stopping before card/billing entry. Do not detach 360dialog or switch the
active provider before the coordinated billing/cutover handoff.

Fresh read-only production checks still pass token, phone ownership, published
Flow and approved v6 templates. subscribed_apps still times out.

Token /me identifies ChatbotPro. Business Settings shows ChatbotPro has Admin
access and Full access to BRT Prototype app, but its two assigned messaging
accounts are 1115806344306399 and 1401614848800726; live account 1548018376588125
is absent. The live account lists 0 people with Full access, 0 Partial access and
1 partner. This is a likely access gap, not yet a proven cause of the timeout.

Owner explicitly approved Full access for ChatbotPro on live messaging account
1548018376588125. Saved the grant using Assign; Meta confirmed People assigned,
1 person added. Then verified People tab lists ChatbotPro with Full access.
This grant includes managing settings/users, viewing payment information and
sending messages. No partner permission was removed.

Reran read-only Meta preflight after the grant: token, phone ownership, phone,
published Flow and approved v6 templates pass; subscribed_apps still times out.
The asset assignment gap is fixed, but subscription readiness is not certified.

Opened the production SPM account's Billing & payments detail page, asset
1548018376588125, payment account 2133746997240676. Verified its name, Add payment
method button and existing Default 360dialog GmbH credit line. Stopped before
clicking Add payment method, as requested. No card details entered or submitted.

The owner's pasted same-account transition advice is also visible in the Meta AI
business assistant conversation. Treat it as AI guidance, not evidence of a human
specialist checking the account. It advises direct billing before partner release
and keeping number registration and the mobile app intact.

### Owner-authorized full cutover follow-up

Owner reports card added and requests completing the switch and eventual
360dialog cancellation. Browser verified a saved Mastercard on the correct live
payment account, but 360dialog credit line remains Default. Card menu offers Set
as default. Requested specific action-time approval before selecting it; pending.

Checked replacement Google key by identity only: .env.google-key-next.json still
matches the live, previously exposed key. Requested the owner create another key
for the same service account and replace that ignored local file, keeping the
current key active until both consumers are updated. No key material was printed.

Both connected Render accounts still return 404 for brt-chatbot-live. Browser
dashboard will be needed for production configuration unless account access is
restored through the connector. No live provider/routing change or cancellation
has yet been performed.

Owner supplied a fresh Google key, validated against both production and staging
calendars; updated ignored local key files and staging env, preserving a backup
of the previously live key. Report: google-key-round-two-validation.json. Owner
specifically approved uploading this replacement to both existing Render services
and deploying their current reviewed commits. Hosted updates remain pending.

Owner approved setting saved card ending 4470 as default. Selecting Set as default
opened Pay current balance, EUR 0.13. Owner separately approved that payment.
Clicked Pay Now; Meta requested the card CVV. Owner handoff requested to complete
verification/payment directly in Chrome. Payment and default-card change are not
yet confirmed. Do not repeat the payment without first checking its outcome.

### Billing failure and completed hosted Google replacement

Owner reported default-card failure: We weren't able to set Mastercard ending
4470 as your default payment method. Please try again.

Read Payment activity and transaction details: failed WhatsApp transaction on
29 October 2026 at 15:36 Singapore time; subtotal EUR 0.13, tax EUR 0.01, total
EUR 0.14. Reference JTHPSC6GU4; transaction
29332523596437681-29383771797979534. Billing reason: No reason available.
The listed product is WhatsApp, not advertising. No retry was submitted. Asked
owner to check whether the card issuer saw/declined this attempt. Direct-card
default status is still unconfirmed; 360dialog remains default.

Updated ONLY GOOGLE_CREDENTIALS_JSON on both Render services using the approved
replacement. Verified the edit-buffer value matches the local compact JSON
without printing the replacement, concealed fields, then saved/deployed.

- Production: dep-dbhfmiuc6qcc73fa6s20, exact b028eef commit, Live at 15:53:28.
- Staging: dep-dbhfnqh42hec73cbld60, existing b313c4f build, Live at 15:55:55.
- Production release smoke checks pass: health, 360dialog authentication,
  unsigned rejection, disabled test route, approved v6 template body matches.
- Staging checks pass: health, Meta signature, foreign account rejection and
  recipient isolation. No customer message was sent by these checks.
- Requested owner verification that production selectable booking dates appear.
  Keep the prior Google key active until hosted calendar confirmation.

No production Meta provider activation, callback change, new subscription,
360dialog credit-line release or subscription cancellation has been performed.

The live server currently authenticates /webhook as 360dialog. Do not change
the app callback to that route and activate production Meta subscriptions while
leaving it in 360dialog mode: signed Meta deliveries would be rejected. Coordinate
callback, subscription and provider activation after billing readiness, or design
and verify a separate passive receiver before any such earlier activation.

1. Inspect current production webhook subscriptions/callback and Business App
   message echoes; the latest read-only API check still timed out on subscribed_apps.
2. Recheck payment setup (last inspected: 360dialog credit line).
3. Read specialist response in support case 1104791312160964 and obtain an
   account-specific coexistence-safe transition and return-to-360dialog procedure.
4. Replace the currently exposed Google key and complete coordinated Meta
   app-secret rotation. Refresh the expired staging Meta token for final rehearsal.
5. Perform a controlled production cutover and acceptance only after the above.

No webhook subscription, billing, registration, number migration, partner release,
or production provider change was performed during this browser inspection.
