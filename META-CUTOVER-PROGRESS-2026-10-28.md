# Meta cutover preparation — 28 October 2026

Production remains on 360dialog. No phone move, partner release, payment method
submission, app subscription change or callback change was performed here.

## Support and subscription

The previous Meta support case 1104791312160964 was marked Completed. Its response
provided only the generic WhatsApp contact page. With explicit owner approval,
an account-specific specialist follow-up was sent in that case chat at 17:09
Singapore time; the UI confirms Message sent by You. A specialist procedure and
return-to-360dialog instructions are still awaited.

Production token, phone ownership and booking/template asset reads pass. The
standard subscribed_apps request times out. A minimal one-record request with
a 45-second timeout returned HTTP 500 / Meta error code 1. No subscription was
changed. Evidence: meta-production-subscription-check.json.

## Billing and account model

The selected messaging account still lists 360dialog GmbH as its default credit
line, with High available credit; no direct payment method was listed. Direct
billing has not been enabled.

Meta Business Settings now displays an account-model update separating phone
numbers (WhatsApp accounts) from templates/payment methods (Messaging accounts).
Meta's official overview describes multiple integrations with separate billing:
https://developers.meta.com/resources/videos/whatsapp-account-model-evolution/

This general model does not establish that this Business App coexistence number
can add an independent direct integration. Account-specific support confirmation
is still required. Do not apply a generic cross-WABA migration guide or remove
the current credit line based on that notice alone.

## Google credential rotation

Owner created a new JSON key for the existing booking-bot service account.
It was validated without printing private key material and successfully read
both production and staging calendars. Local google-service-account.json and
.env.staging now use the replacement. All key files and the rollback copy are
ignored by Git. Evidence: google-key-next-validation.json.

Hosted installation is pending owner entry in Render. The owner should replace
only GOOGLE_CREDENTIALS_JSON using .env.google-key-next.compact.json and Save only.
Deploy these exact currently reviewed commits after each saved setting:

- brt-chatbot-live: b028eeffb2bf6e880c93881ad1d2b6ad3f7ef39d
- brt-meta-rehearsal: b313c4f7ae4118e378864c7ae0ed80d3c49734d4

Then verify health and calendar access before disabling the old Google key.
The old key remains active; hosted rotation is not yet certified complete.
Meta app-secret rotation remains pending and must update every consumer and
revalidate tokens and signed webhooks. Do not reset it as an uncoordinated step.
