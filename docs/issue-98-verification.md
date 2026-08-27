# Common not-found page (#98)

Adds a shared root not-found component using existing Card/PageHeader/button styles. Authenticated users return to Today; anonymous users return Home the landing page. No history dependency, database mutation, broad error catch or authentication bypass is added. Medication details already call `notFound` for absent IDs; nonexistent document URLs use the same root boundary after the existing authentication gate.

Verified on 2026-08-28:

- `npm run verify`: unit tests, typecheck, lint, production build, six Firestore Admin/REST integration contracts, four production browser/API scenarios pass.
- Unknown URLs and signed-in missing medication/document paths return HTTP 404. Authentication redirects remain intact. Orphaned canonical data produces a real server error, not a 404.
- Reload, history-independent return, 320/768/1024/1440 widths, heading/link semantics and keyboard activation covered by E2E.
- `npm run cf:build --workspace @care-atlas/front` passes.
- In-app browser: rendered production 404 visually inspected; Home link successfully returned to the landing page. Actual screen-reader/OS-specific audit is tracked in #64.

No production deployment or real account/health-data mutation was performed.
