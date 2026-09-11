// Shared extraction/evaluation contract. Failure is never a successful empty observation.
export const PILL_PHOTO_FAILURE_REASONS = [
  "transfer_not_confirmed", "unreviewed_photo", "invalid_photo", "duplicate_photo", "not_configured",
  "refused", "incomplete_response", "invalid_response", "invalid_request", "access_denied",
  "rate_limited", "provider_unavailable", "timeout", "network_error", "ocr_failed", "fusion_failed",
] as const;
export type PillPhotoFailure = typeof PILL_PHOTO_FAILURE_REASONS[number];
