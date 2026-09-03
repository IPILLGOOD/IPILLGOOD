import { canAutomaticallyReconnect, inspectPushClient, reconnectPushNotifications } from "./client.ts";

/** One automatic attempt per minute after failure; subsequent reentry events retry. */
export function createPushRefresher(now = Date.now, expectedSessionKey?: string) {
  let retryAfter = 0;
  return async (signal?: AbortSignal) => {
    const state = await inspectPushClient(signal, expectedSessionKey);
    signal?.throwIfAborted();
    if (!canAutomaticallyReconnect(state) || now() < retryAfter) return state;
    retryAfter = now() + 60_000;
    try {
      const refreshed = await reconnectPushNotifications(signal, expectedSessionKey);
      if (refreshed.subscribed) retryAfter = 0;
      return refreshed;
    } catch {
      signal?.throwIfAborted();
      // Stay disconnected and retry on a later reentry, without an intrusive notice.
      return state;
    }
  };
}
