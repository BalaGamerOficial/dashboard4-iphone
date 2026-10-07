const CACHE = "dashboard4-iphone-361cf024bb368bfb";
const SHELL = ["./", "./index.html", "./app.css", "./app.mjs", "./model.mjs", "./protocol.mjs", "./session.mjs", "./source.json", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

function readDeviceKey() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dashboard4-iphone", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("local").objectStore("local").get("pairingKey");
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  });
}

async function deviceManifest() {
  const key = await readDeviceKey();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key || "")) return new Response("Enlaza primero este dispositivo.", { status: 401 });
  const cache = await caches.open(CACHE);
  const template = await cache.match("./manifest.webmanifest");
  const manifest = await template.json();
  const scope = self.registration.scope;
  // Generated only inside this device's SW. There is no private manifest file
  // on the server. The saved launch URL carries a fragment, never an HTTP key.
  manifest.id = scope;
  manifest.scope = scope;
  manifest.start_url = `${scope}#k=${key}`;
  manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: new URL(icon.src, scope).href }));
  return new Response(JSON.stringify(manifest), { headers: {
    "Content-Type": "application/manifest+json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key.startsWith("dashboard4-iphone-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    const key = await readDeviceKey().catch(() => null);
    for (const client of await self.clients.matchAll({ type: "window" })) {
      const url = new URL(client.url);
      const scopePath = new URL(self.registration.scope).pathname;
      if (url.origin !== self.location.origin || ![scopePath, `${scopePath}index.html`].includes(url.pathname)) continue;
      // The first version removed the fragment and has no update listener.
      // Reload it from this complete shell, restoring its verified device key.
      if (/^[A-Za-z0-9_-]{43}$/.test(key || "") && !new URLSearchParams(url.hash.slice(1)).has("k")) {
        url.hash = new URLSearchParams({ k: key, install: "1" }).toString();
      }
      // Start navigation but let activation finish before its fetch is handled.
      void client.navigate(url.href).catch(() => {});
    }
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("/snapshot.json")) return;
  if (url.pathname === new URL("private-install.webmanifest", self.registration.scope).pathname) {
    // Never fall back to the network or cache a response containing the key.
    event.respondWith(deviceManifest().catch(() => new Response("No se pudo preparar la instalación.", { status: 503 })));
    return;
  }
  if (event.request.mode === "navigate") {
    // The complete static shell opens immediately even if the Mac and network
    // are unavailable. Updates arrive atomically through the next SW install.
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match("./index.html")) || fetch(event.request)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(event.request, { ignoreSearch: true })) || fetch(event.request)));
});
