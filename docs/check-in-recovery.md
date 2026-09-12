# Check-in recovery

Question availability is explicit: only a transactionally published question set can render an editable form. A failed publication/busy lease returns an unavailable panel with retry. The existing distributed generation checkpoint is reused; no provisional ID is passed to the client.

Both Today and detailed check-in retain responder, dose choices, symptoms, severity, note and question answers in component memory. React's automatic form reset is prevented because it resets checkbox DOM state even after a handled server error. There is no localStorage/sessionStorage copy of health information. Leaving or reloading the page ends this in-memory recovery guarantee, which is why recovery uses an authenticated, rate-limited server action without navigation.

Missing/stale question sets offer an explicit recovery button. Identical set IDs retain question choices; a changed set clears only the old question answers so they cannot be assigned to different questions. Other fields remain. Recovery rechecks the current account and never trusts a client-supplied recipient ID. Submit is disabled during recovery; nothing is auto-submitted.

Regression coverage is included in `npm run verify -- --account-full-cycle`: failed publication, missing question recovery, in-memory input preservation, active generation leases and successful resubmission. Real-device assistive technology requires separate verification.
