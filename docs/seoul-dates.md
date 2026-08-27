# Seoul calendar dates (#49)

`backend/src/dates.ts` is the shared, browser-safe implementation (`@care-atlas/backend/dates`). Existing backend date-key exports remain compatible re-exports. No stored instant is rewritten and no medication plan is migrated.

- Instants retain their UTC ISO representation or explicit offset. Ambiguous local timestamps are rejected.
- Calendar dates retain `YYYY-MM-DD` meaning; display, elapsed days, symptom days, check-in keys and schedule matching use Asia/Seoul explicitly.
- Calendar addition/difference handles leap days and year/month boundaries without depending on the host time zone.
- Periods use an inclusive start and exclusive end. Care Agent retains the previous 14 calendar days, excluding the target date. This also removes the old one-millisecond lower-bound overlap.
- Existing `daysSince` minimum of one day is preserved; this change does not decide prescription dates or alter recurrence rules (#44/#67).
- #53's metric denominators and #78's occurrence ledger are not implemented here.

Unit tests vary the host TZ (UTC, Los Angeles, Honolulu, Seoul), test midnight/leap/year boundaries and UTC/KST equivalent dose timestamps. Production E2E checks actual document HTML and hydrated UI with three browser time zones. Changing a period boundary can change a question input revision only for records on that boundary; old records remain intact.
