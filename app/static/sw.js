const CACHE_NAME = "partytube-assets-v12";
const STATIC_URLS = [
  "/static/css/styles.css",
  "/static/js/shared.js",
  "/static/js/guest.js",
  "/static/js/admin.js",
  "/static/js/audio.js",
  "/static/js/player.js",
  "/static/js/start.js",
  "/static/js/qr.js",
  "/static/js/history.js",
  "/static/js/best_of.js",
  "/static/js/party_screen.js",
  "/static/js/pwa.js",
  "/static/img/logo.svg",
  "/static/img/icon.svg",
  "/static/img/icon-128.png",
  "/static/img/icon-192.png",
  "/static/img/icon-512.png",
  "/static/img/apple-touch-icon.png",
  "/manifest.webmanifest",
];

function isStaticAsset(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return STATIC_URLS.includes(url.pathname) || url.pathname.startsWith("/static/");
}

function shouldBypassCache(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname === "/admin" || url.pathname === "/player" || url.pathname === "/audio") return true;
  if (url.pathname.startsWith("/admin/") || url.pathname.startsWith("/player/") || url.pathname.startsWith("/audio/")) {
    return true;
  }
  return false;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw _error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (shouldBypassCache(event.request)) return;

  if (!isStaticAsset(event.request)) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});
