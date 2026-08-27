export type PushKeyStatus = "none" | "matched" | "mismatch" | "unverifiable";

export function decodePushPublicKey(publicKey: string) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(publicKey)) throw new Error("Invalid Push public key");
  const raw = publicKey.replace(/=+$/, "");
  const bytes = Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid Push public key");
  return bytes;
}

export function pushKeyStatus(boundKey: ArrayBuffer | null, publicKey: string): Exclude<PushKeyStatus, "none"> {
  const expected = decodePushPublicKey(publicKey);
  if (!boundKey) return "unverifiable";
  const bound = new Uint8Array(boundKey);
  return bound.length === expected.length && bound.every((byte, index) => byte === expected[index]) ? "matched" : "mismatch";
}

export function subscriptionExpired(expirationTime: number | null | undefined, now = Date.now()) {
  return typeof expirationTime === "number" && Number.isFinite(expirationTime) && expirationTime <= now;
}

export async function pushEndpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function withPushTimeout<T>(operation: Promise<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("알림 확인 시간이 초과됐어요. 다시 확인해 주세요.")), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
