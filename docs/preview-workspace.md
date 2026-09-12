# Public sample workspace

## Open and use

Run `npm run dev`, then open `/preview`. `/preview-device` embeds the same route at 390, 768 or 1440 pixels. Home and login include sample-preview links. No Firebase account, document file, AI key, or demo-session provisioning is needed.

The workspace includes Today, Dashboard, Medications (with selection and detail), Nutrition, Check-in, Documents, Profile and Report. The toolbar selects populated, empty, loading and recoverable error presentations. Document processing and check-in submission also have a short simulated pending state. Reset restores the fixtures; navigating inside the workspace retains changes; a browser refresh starts over.

## Architecture and data flow

`preview/layout.tsx` keeps `PreviewWorkspace` mounted across child routes. Its local React state owns fictional medications, dose responses, documents, confirmed conditions and connection/check-in status. `preview-data.ts` supplies fictional names and sample content, plus seven days of dose records relative to the current Seoul date. Nothing is written to a real account or persistent browser storage.

- A sample prescription review registers a medication in the shared sample list and adds today's dose. The medication cabinet, calendar and report consume that state.
- Dose response edits update the same state. `DoseResponseEditor` accepts a callback through `PreviewDoseAction`; without that provider its original authenticated server action remains the default.
- Profile and diagnosis review update the confirmed-condition list used by `NutritionExplorer`. Nutrition receives a sample loader; the default production request still uses the authenticated API.
- Check-in completion, connection code/connected states and notification toggles are local simulations. No actual push, connection invitation, document extraction or LLM call takes place. Sample articles explicitly say that no real original/video is provided.

The calendar, medication cabinet, nutrition explorer, document analysis result, confirmed-condition editor and basic UI primitives are reused. The preview's document-review, profile, check-in and connection orchestration is deliberately simpler than the production server-backed flows. This is a UI exploration tool, not an end-to-end Firebase/OAuth/OCR/LLM test. It does not emulate every administrative, account-deletion, conflict-resolution or provider-specific failure screen.

The standard page authentication and API permissions are unchanged. Only `/preview` and its children allow **same-origin** framing for device previews; other pages and APIs retain their framing restrictions. External websites cannot embed the preview. The sample route does not enable real account mutation or background synchronization.

## Verification

The preview E2E exercises sample document review and registration, medication selection, dose editing, confirmed conditions, nutrition filters, connection and check-in simulations. It checks empty/loading/error/retry states and responsive layouts. These checks run with the isolated verification suite. They do not validate real Firebase, OAuth, OCR, AI or Push integrations.
