const CACHE_VERSION = "ipillgood-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("ipillgood-") && key !== CACHE_VERSION).map((key) => caches.delete(key))),
      ),
    ]),
  );
});
