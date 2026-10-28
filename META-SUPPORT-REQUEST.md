# Meta support inquiry: coexistence provider release and direct billing

## Follow-up prepared 28 October 2026 (not sent)

For existing case 1104791312160964: please escalate to the WhatsApp Business
Platform/coexistence team. We need an account-specific procedure for retaining
our existing Business App coexistence number while moving from 360dialog billing
to our own Meta app. Please also confirm the return procedure before any move:

- Can the current WABA, phone registration, mobile app and message history remain
  intact? If a same-WABA provider/credit-line release is supported, give the exact
  sequence for billing, app subscription and message echoes.
- If direct Meta messaging fails after release, what exact steps restore
  360dialog service on this same coexistence number? Identify any re-onboarding,
  approval, PIN/verification, fees, expected outage, or restrictions.
- At what step does rollback stop being a configuration-only operation? Can the
  current 360dialog subscription/credit line remain until acceptance succeeds?
- Production subscribed_apps reads still time out despite valid token/asset
  reads. Please confirm the app subscription and supported callback arrangement.

This is an instructions-only inquiry. Do not release the partner/credit line,
disconnect the app, migrate the number, disable 2FA, or cancel any service.

---

Submitted to Meta Business support chat on 2026-10-26, with owner approval. The UI displayed "Message sent" and the full request under "You sent", but also continued to show "Sending". Delivery to a human and case creation are not confirmed. No case ID or human response observed yet. No transfer or disconnection is authorized.

To: 360dialog support / Meta WhatsApp Business Platform support

We are preparing to operate our existing chatbot through our own approved Meta
app, while retaining WhatsApp Business mobile app coexistence. Please confirm
the supported preparation and future migration procedure before we change any
production configuration.

Business portfolio: 2823279941398827 (BRT Prototype)
App: 2157340598183627 (BRT Prototype)
Current WABA: 1548018376588125
Phone ID: 1394261800429249; business phone: +65 80583517
The WABA is business-owned and approved. The phone reports is_on_biz_app=true,
platform_type=CLOUD_API. Current payment method is the 360dialog GmbH credit line.

1. Can this same WABA and phone remain in place while 360dialog partner/credit-line
   billing is released and our own Meta app handles the Cloud API?
2. If not, what supported coexistence re-onboarding procedure preserves the mobile
   app and chat history? Your coexistence documentation says cross-WABA migrations
   are unsupported; please identify the applicable route for this account.
3. What needs to be prepared for direct Meta billing, and in what order, without
   interrupting current 360dialog messaging? Confirm whether any outstanding invoice
   or provider release condition applies.
4. Our production SYSTEM_USER token has both WhatsApp scopes and can read the phone,
   templates and published Flow, but GET /1548018376588125/subscribed_apps repeatedly
   times out, including a fields-limited query. What should we check for coexistence
   app subscription access? We have not changed subscriptions or callbacks.
5. Confirm how messages and smb_message_echoes should be routed to our own app,
   and whether approved templates/booking Flow can remain accessible on this WABA.

Please provide instructions only. Do not disconnect, release, migrate, disable 2FA,
change the credit line, cancel service or alter our live number at this stage.

Submission note: the initial support intake limited the first entry to 1,000 characters. Additional details supplied the no-transfer instruction and remaining questions; the complete request was subsequently sent in the support chat. No request was sent to 360dialog.
