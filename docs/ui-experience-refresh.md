# UI refresh and public sample workspace

## Open and use

Run `npm run dev`, then open `/preview`. `/preview-device` embeds the same route at 390, 768 or 1440 pixels. Home and login include sample-preview links. No Firebase account, document file, AI key, or demo-session provisioning is needed.

The workspace includes Today, Dashboard, Medications (with selection and detail), Nutrition, Check-in, Documents, Profile and Report. The toolbar selects populated, empty, loading and recoverable error presentations. Document processing and check-in submission also have a short simulated pending state. Reset restores the fixtures; navigating inside the workspace retains changes; a browser refresh starts over.

## Architecture and data flow

`preview/layout.tsx` keeps `PreviewWorkspace` mounted across child routes. Its local React state owns fictional medications, dose responses, documents, confirmed conditions and connection/check-in status. `preview-data.ts` supplies fictional names and sample content, plus seven days of dose records relative to the current Seoul date. Nothing is written to a real account or persistent browser storage.

- A sample prescription review registers a medication in the shared sample list and adds today's dose. The medication cabinet, calendar and report consume that state.
- Dose response edits update the same state. The calendar now includes the selectively integrated feature/new_work updates described in selective-new-work-integration.md. `DoseResponseEditor` accepts a callback through `PreviewDoseAction`; without that provider its original authenticated server action remains the default.
- Profile and diagnosis review update the confirmed-condition list used by `NutritionExplorer`. Nutrition receives a sample loader; the default production request still uses the authenticated API.
- Check-in completion, connection code/connected states and notification toggles are local simulations. No actual push, connection invitation, document extraction or LLM call takes place. Sample articles explicitly say that no real original/video is provided.

The calendar, medication cabinet, nutrition explorer, document analysis result, confirmed-condition editor and basic UI primitives are reused. The preview's document-review, profile, check-in and connection orchestration is deliberately simpler than the production server-backed flows. This is a UI exploration tool, not an end-to-end Firebase/OAuth/OCR/LLM test. It does not emulate every administrative, account-deletion, conflict-resolution or provider-specific failure screen.

The standard page authentication and API permissions are unchanged. Only `/preview` and its children allow **same-origin** framing for device previews; other pages and APIs retain their framing restrictions. External websites cannot embed the preview. The sample route does not enable real account mutation or background synchronization.

## Design decisions

References: [Toss](https://toss.im/), [Apple Korea](https://www.apple.com/kr/), and the public [React Bits Pro component previews](https://pro.reactbits.dev/docs/components), including Blur Highlight and the earlier card previews. No paid source was copied.

`experience-refresh.css` supplies the final UI layer: neutral white/gray surfaces, dark typography, restrained green actions, 3–6px corner radii, thin separators and section-based lists. Page headings have no pointer-following glow, radial decoration or enclosing pastel panel. Navigation uses simple selection backgrounds. List entry motion is short and disabled for reduced-motion preferences. Root density and shell geometry remain in their existing layers. Calendar-specific updates are now included under the subsequent selective-integration request.

## Verification

- Actual Next dev route exercised in the browser without login.
- Sample prescription analysis → review → registration → medication selection verified.
- Dose editing, condition addition → profile save → nutrition condition list, source filters, connection code → connected, and check-in completion verified.
- Empty/loading/error/retry presentations exercised.
- All eight primary preview screens have document scrollWidth equal to viewport width at 390px and 1440px. A dedicated same-origin iframe is used because the current in-app browser viewport override did not change its actual viewport.
- Lint, TypeScript and production build are checked separately; unit suite results are reported with delivery. Existing production service integrations are outside this UI-only verification.
