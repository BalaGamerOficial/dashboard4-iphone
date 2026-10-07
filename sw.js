const CACHE = "dashboard4-iphone-aaf5d5f1da715d80";
const SHELL = ["./", "./index.html", "./app.css", "./app.mjs", "./model.mjs", "./protocol.mjs", "./source.json", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("dashboard4-iphone-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/snapshot.json")) return;
  if (event.request.mode === "navigate") {
    // The complete static shell opens immediately even if the Mac and network
    // are unavailable. Updates arrive atomically through the next SW install.
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match("./index.html")) || fetch(event.request)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request)));
});
