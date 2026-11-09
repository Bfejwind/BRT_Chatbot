# Serverless message handling

Target: Supabase project `ixjmzksmazysazlyoxne`, function `whatsapp-bot`.

Current status: a disabled function was deployed through the existing browser session, importing the pinned bundle from commit `74c47c8b3f2c8b9e00481a34cc3cc487adf37dc1` on `codex/serverless-messages`. The gateway still requires authorization (unauthenticated health request returned 401). Production migrations, custom secrets, recovery scheduling and webhook cutover have not been applied. The live callback remains on Render. Supabase deployment/admin access is required to complete those steps.

The function runs the booking, FAQ, language and staff-contact handlers directly. It does not proxy messages to Render. An authenticated webhook request is acknowledged only after its messages are committed to `bot_inbox`. Background processing is bounded to fit the free Edge Function execution window. A database cron job invokes recovery when pending work exists.

The inbox serializes each customer's messages across instances. Conversation language and handover status persist in `bot_conversations`. Reply checkpoints prevent accepted sends from being replayed. Uncertain sends are marked `unknown` for review. Known rejections can retry, up to five inbox attempts. A database limiter coordinates the channel and recipient pacing across instances. A recipient's waiting time does not reserve the channel for other customers.

## Build and test

```
node scripts/build-serverless.js
node --test tests
npx deno@2.5.6 run --config supabase/functions/whatsapp-bot/deno.json --node-modules-dir=none --allow-env --allow-read --allow-sys serverless/smoke.ts
```

The build replaces the legacy HTTP listener with a native fetch entrypoint and packages the existing handlers. A small Calendar v3 adapter preserves `calendarService.js` while avoiding the large Google APIs catalogue. Serverless message execution uses durable send checkpoints instead of the process-wide sender queue. The existing Render application is not modified by this build.

## Deployment sequence

1. Apply `migrations/009_serverless_messages.sql` and `010_serverless_recovery.sql`. Tables and privileged functions are restricted to the service role. The recovery migration requires Supabase Vault, pg_cron and pg_net.
2. Run `node scripts/prepare-serverless-secrets.js`. Import its ignored `.env.serverless-deploy` file into this project's Edge Function secrets. It contains the existing database, WhatsApp and Google Calendar credentials, not newly provisioned credentials. Never commit, print or upload that file to a source repository. `BOT_SERVERLESS_ENABLED=false` keeps inbound processing disabled initially.
3. Deploy `supabase/functions/whatsapp-bot` with JWT gateway verification disabled. The application verifies the existing `X-Webhook-Secret` itself. `/work` and `/prepare` require `X-Worker-Secret`; by default it uses the same existing webhook credential.
4. Check `/health`, unsigned request rejection, the live database schema, Google Calendar read access and outbound provider connectivity. Do not create customer bookings as probes.
5. Invoke `/prepare` with the worker credential. This stores the worker credential in Vault and configures the one-minute recovery schedule. The schedule only calls the worker when queued or expired processing jobs exist.
6. Enable `BOT_SERVERLESS_ENABLED=true`, redeploy, verify the authenticated empty webhook, then update the 360dialog callback to `https://ixjmzksmazysazlyoxne.supabase.co/functions/v1/whatsapp-bot/webhook` with the existing webhook secret. Read the callback back to verify it saved.
7. Verify a real incoming conversation receives its reply and retains its language through a fresh instance. Confirm database inbox and outbox results before reporting the migration complete.

## Boundaries and rollback

Render remains available for rollback and retains its current reminder, calendar recovery and booking completion timers. This migration moves interactive message handling only; unattended scheduled reminders on a sleeping Render service are not made always-on by this change. The pending v7 reminder templates are not activated by the migration.

Changing the callback back to `https://brt-chatbot-live.onrender.com/webhook` restores the prior endpoint. Disable the Edge Function before rollback and inspect active inbox jobs to prevent both endpoints processing the same retries. Do not replay `unknown` deliveries without review.

Existing language choices can be restored from booking drafts. Staff-handover windows held only in the old Render process cannot be reconstructed; new authenticated echo events are persisted after cutover.

`bot_inbox`, `bot_outbox` and conversation state contain customer data. Keep their RLS and service-role-only access. Add a retention policy suited to business requirements before long-term operation. Free-tier quotas and upstream WhatsApp/API availability still apply.
