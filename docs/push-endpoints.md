# Push endpoint registration (#75)

The registration API uses `front/src/lib/push/endpoint.ts` as its sole allowlist. DNS suffixes must include the dot boundary; credentials, non-default ports, fragments, non-HTTPS URLs and unrelated hosts are rejected. Query tokens are preserved unchanged. This change does not alter delivery, retries, opt-in or account binding.

Microsoft documents [Windows Edge's WNS client](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/ForceBuiltInPushMessagingClient) and requires validating the `notify.windows.com` domain while allowing variable subdomains in the [WNS overview](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview#requesting-a-notification-channel).

`npm run verify` covers provider-shaped URLs with synthetic tokens, malicious host variants and authenticated registration/status through the production server with Firestore emulators. It never sends to a real Push service. Actual Windows device delivery remains a deployment smoke test: enable notifications in Edge, check registration, send an explicitly requested test notification, then disable and verify the subscription is inactive. Do not put real endpoint tokens in test fixtures or logs.
