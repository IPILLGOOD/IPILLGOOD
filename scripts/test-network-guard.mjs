// Test-process preload only. Never imported by the application.
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

if (!process.env.FIREBASE_PROJECT_ID?.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
  throw new Error("Tests must use a demo- project and a loopback emulator.");
}
function allow(host) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`TEST_EXTERNAL_NETWORK_BLOCKED: ${host}`);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  allow(new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname);
  return originalFetch(input, init);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === "object") {
    if (!options.path) allow(options.host ?? "localhost");
  } else if (typeof options === "number") allow(typeof args[1] === "string" ? args[1] : "localhost");
  else if (typeof options === "string" && !options.startsWith("/")) allow(options);
  return connect.apply(this, args);
};
syncBuiltinESMExports();
