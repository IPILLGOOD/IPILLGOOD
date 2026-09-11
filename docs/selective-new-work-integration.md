# Selected feature integration into UI_updates

Source: `origin/feature/new_work` at `56ea3fef221379a36e06a4636b98d7f7c4e603d7`.
The requested `feature/new_update` did not exist on origin; `feature/new_work` contains the named features. Comparison base: `889217f41126acaa1c0573183e2a634f5ab45a48`.

This is a selective working-tree integration, not a whole-branch history merge. Existing uncommitted UI, nutrition and preview changes are retained. The pre-integration work was also saved outside the repository in `/tmp/ipillgood-before-selective-20260909-212230/`. The nutrition stash and branch were not changed. No push was made.

## Included

- Medication search/add: authenticated, rate-limited official product search; dose/frequency/timing/date form; repository insertion; updated medication read model, schedules and reminder intent. The server re-verifies the official item code before registration instead of trusting hidden product-name fields. Duplicate products, invalid dates and stale revisions return recoverable errors. IDs use UUIDs to prevent same-second collisions.
- Dashboard/calendar: the source's calendar-focused page, day completion/missed colors, individual daily dose slots, prior-date responses and immediate check/cross controls. The preview callback remains connected, so sample clicks cannot invoke real account writes.
- Medication bags: shared prescription/bag upload option; optional manually entered condition label; expanded document types; AI extraction instructions for bag dispensing dates; official medication evidence, draft generation and review before activation. Existing diagnosis-document registration remains available. A manual condition label does not automatically become a confirmed profile diagnosis. Existing hash behavior is retained when the optional label is empty.

## Preserved / excluded

Current compact UI, nutrition exploration, dynamic confirmed-condition editing, public preview and same-origin device preview remain. The source's medication-removal feature, check-in page changes and general configuration change were excluded. Existing five-state dose support remains for current check-in clients; the imported calendar presents its two quick actions. No unrelated nutrition or profile changes from the remote were imported.

## Data flow and evaluation

Search → canonical item verification → consent/revision guarded repository transaction → medication read model → calendar/Today. Document file → existing processing job → extraction/official matching → review draft → existing confirmation flow. The LLM only participates in the existing real document-analysis pipeline; the sample preview uses fictional local results.

Browser checks cover sample search → medication added → calendar occurrence, missed-day styling, and prior-date response insertion. Repository regression tests cover consent, revision conflicts, duplicates, invalid input, and prescription/bag draft behavior. Type checking, lint, full unit suite and production build are run for the integration. Live Firebase, MFDS and OCR services are not exercised by the sample UI tests.
