# WhatsApp connection incident — 4 November 2026

Service: brt-chatbot-live (srv-dbgkmjm7bikc73afi43g), Render Singapore.

## Verified findings

- The Render WHATSAPP_API_KEY matches the local key that successfully authenticated read-only 360dialog configuration requests. No key values were copied into this report.
- The configured provider is 360dialog and the configured API base is https://waba-v2.360dialog.io.
- The channel webhook points to https://brt-chatbot-live.onrender.com/webhook and its shared secret matches the local configuration. An authenticated empty event returns HTTP 200.
- The local checkout is 238f0c3; Render was running 2808fefa57e5115262ec64447925ed8273ce5fc6 from codex/reminder-v5-live. Recent local commits were not active in production.
- Production logs show TCP connection timeouts to 34.116.153.98:443, including after a restart.
- Read-only diagnostics executed on Render at 17:35 Singapore time failed with both Axios (default DNS and forced IPv4) and Node native HTTPS. Axios reported connected=false and tls=false. Failure occurs before TLS or API authentication, so rotating the key would not address this observed failure.

## Diagnostic deployment and cleanup

Diagnostic deployment: dep-dblfo6lbedkc73ah1s80, same source commit 2808fef. It reached Live. Startup-only diagnostics made GET requests to the existing provider using its existing key; no synthetic customer message was sent. The application started normally alongside these checks.

The saved Start Command was restored to npm start and verified in the dashboard. The active process was launched with startup diagnostics, which have finished; its application code remains the same. No second deployment was performed just to remove finished startup checks from that process. No keys, webhook configuration, source branch, compute plan, or database records were changed by this investigation.

## Support request draft (not sent)

Our Render Singapore service brt-chatbot-live cannot establish outbound TCP connections to waba-v2.360dialog.io (34.116.153.98) on port 443. Inbound webhooks reach the service successfully. The same authenticated read-only configuration requests succeed from our workstation in under one second.

On 4 November 2026 around 09:35 UTC / 17:35 Singapore time, default Axios, forced-IPv4 Axios, and Node native HTTPS all timed out from Render. Axios reported no established connection and no TLS handshake. Earlier runtime logs explicitly reported connect ETIMEDOUT 34.116.153.98:443. A restart did not resolve the failure.

Please investigate routing or filtering between this Render service's outbound network and 360dialog's API endpoint. We have not established which provider is responsible. We can supply the service's outbound IP ranges through a private support channel if needed. Please do not request API keys in tickets or logs.

## Remaining work

360dialog dashboard verification: the channel is Ready, the subscription is Active, quality is High, the WABA is Live, and balance is positive (€2.23). The cancellation request on 29 October was revoked. Activity history lists the most recent API-key creation on 2 October and the expected callback URL change on 28 October. No channel suspension or recent key regeneration was shown. The support panel reports all systems operational. No support message was sent and no 360dialog configuration was changed.

Resolve the provider network path through Render/360dialog support, or prepare and verify an owner-approved hosting relocation. Then verify a fresh real inbound greeting receives a reply. Do not report the chatbot as repaired until that succeeds.
