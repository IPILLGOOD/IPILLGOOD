# Push lifecycle security (#73)

No screen, label or control is added. The existing opt-in and logout controls use the following protocol.

- `/api/push/config` returns a fingerprint of the current login identity. Browser requests must match the identity rendered with the page, preventing an old tab from changing a newly signed-in account. Connected-session expiry refresh preserves this identity; a fresh login creates a new one.
- `POST /api/push/subscriptions` prepares an **inactive** registration and returns a signed, HttpOnly binding cookie. `PATCH` acknowledges the cookie and activates that exact generation. Subscription activation and canonical reminder schedules commit in one Firestore transaction; the response uses its result without a second database read. An unacknowledged preparation cannot send.
- Device IDs and endpoint reuse revoke previous active/pending registrations. Automatic repair is restricted to an already opted-in or pending registration for the same login; opt-out clears both states.
- Logout attempts browser unsubscribe and closes visible notifications, then removes the login session. The server atomically disables the subscription and queues schedule reconciliation. If revocation fails, its signed, generation-scoped cookie remains available to `/api/push/cleanup`, including after logout. It grants no health-data access and cannot disable a later opt-in.
- Public pages retry server/browser cleanup on reload, online/pageshow and every minute while failed. Browser cleanup failure does not skip server cleanup. New opt-in waits for pending browser cleanup. Web Locks serialize cleanup and registration across tabs when supported (otherwise per-context serialization plus server generation checks apply).
- Push payloads identify their subscription generation. The service worker checks the current session, binding and server active status before display and before opening a notification. Missing/old bindings, expired sessions and unavailable authorization suppress the notification. Raw endpoint URLs, keys and session credentials are not added to logs.

## Verification and rollout boundaries

Use Node 24 or another runtime supporting `node:module.registerHooks` for the repository tests. The system Node 23.3 does not support the existing scheduled-worker test or the route harness.

Regression coverage includes unconfirmed registration, failed schedule reads/commits, lost activation responses, logout revocation failure and anonymous retry, stale cleanup vs. fresh opt-in, shared endpoint/account transitions, stale tabs, connected-session renewal, and queued notification display/click rejection.

Deploy the app and `sw.js` together. Legacy registrations without a login binding require explicit opt-in through the existing control; they are not silently migrated. A previously installed worker must receive the update before it enforces the new display gate. A notification already delivered to an OS or push-service queue cannot be recalled by a server transaction; browser cleanup closes locally accessible notifications, and the updated worker rejects stale arrivals/clicks.

Authorization failure deliberately suppresses display, including temporary network/server failures. There is no offline replay of health notifications. Revocation that could not reach storage retries when the browser is next available; before then the updated worker still refuses display without the matching session. Real-device delivery/worker-update behavior (including browser-generated generic fallback notifications) remains a deployment smoke test, separate from local synthetic verification.

## Local verification — 2026-08-31

The final code passed `npm run verify` in an isolated copy with no local credential files, using Node 24.19 and Java 21: 286 unit/route/worker tests, 13 Firestore/Auth emulator contracts, and 24 browser/API tests. Type checking, lint and the production build also passed. The local report is `verification-artifacts/issue-73/verification.json`. No production push, merge or deployment was performed.
