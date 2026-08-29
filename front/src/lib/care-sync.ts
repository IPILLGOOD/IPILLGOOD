export const CARE_SYNC_POLL_INTERVAL_MS = 5_000;
export const CARE_CONNECTION_ACTIVITY_INTERVAL_MS = 15 * 60_000;

export function shouldPollCareRevision(input: {
  visible: boolean;
  online: boolean;
  inFlight: boolean;
  retryAt: number;
  now: number;
}) {
  return input.visible && input.online && !input.inFlight && input.now >= input.retryAt;
}

export function careSyncFailureDelay(failures: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(failures, 1), 6));
}

export function retryAfterMilliseconds(value: string | null) {
  return Math.max(1, Number(value) || 5) * 1_000;
}
