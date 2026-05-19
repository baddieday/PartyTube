const CACHE_NAME = "partytube-assets-v7";
const STATIC_URLS = [
  "/static/css/styles.css",
  "/static/js/shared.js",
  "/static/js/guest.js",
  "/static/js/admin.js",
  "/static/js/audio.js",
  "/static/js/player.js",
  "/static/js/start.js",
  "/static/js/qr.js",
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

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (!isStaticAsset(event.request)) {
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
