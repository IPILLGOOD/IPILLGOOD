// Optional verification-process preload ONLY. Application code never imports this file.
// Replaces the external Firebase JWKS response, not token verification or application APIs.
import { readFileSync } from "node:fs";

if (!process.env.FIREBASE_PROJECT_ID?.startsWith("demo-") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
    !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.IPILLGOOD_TEST_JWKS_PATH || !process.env.IPILLGOOD_TEST_CLOCK_PATH) {
  throw new Error("Synthetic identity provider requires isolated local verification.");
}

const jwks = readFileSync(process.env.IPILLGOOD_TEST_JWKS_PATH, "utf8");
const guardedFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url === "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com") {
    return Promise.resolve(new Response(jwks, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }));
  }
  return guardedFetch(input, init);
};

// Advance only this isolated application process, not the OS clock or production configuration.
const NativeDate = Date;
const offset = () => {
  const value = Number(readFileSync(process.env.IPILLGOOD_TEST_CLOCK_PATH, "utf8"));
  if (!Number.isFinite(value) || value < 0 || value > 370 * 86400_000) throw new Error("Invalid verification clock offset.");
  return value;
};
function VerificationDate(...args) {
  if (!new.target) return new NativeDate(NativeDate.now() + offset()).toString();
  return Reflect.construct(NativeDate, args.length ? args : [NativeDate.now() + offset()], new.target);
}
// Next wraps Date by copying its own descriptors; inherited UTC/parse on a subclass are lost.
Object.defineProperties(VerificationDate, Object.getOwnPropertyDescriptors(NativeDate));
VerificationDate.now = () => NativeDate.now() + offset();
globalThis.Date = VerificationDate;
