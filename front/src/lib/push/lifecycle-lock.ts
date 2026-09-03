let pending: Promise<unknown> = Promise.resolve();

/** Serialize registration and cleanup across tabs; fallback for older browsers is per context. */
export function withPushLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("ipillgood-push-lifecycle", work);
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}
