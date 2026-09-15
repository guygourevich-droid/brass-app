// Offline support. Saves every file below on the device the first time the app opens online.
// When you add or rename a file: add it to FILES and bump the version in CACHE.
const CACHE = "brass-app-v3";
const FILES = [
  "./",
  "index.html",
  "balloon-breath.html",
  "buzz-along.html",
  "clap-along.html",
  "manifest.json",
  "fonts/fonts.css",
  "fonts/lexend-400-700-latin.woff2",
  "fonts/atkinson-hyperlegible-400-latin.woff2",
  "fonts/atkinson-hyperlegible-700-latin.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Try the internet first (so updates show up), give up after 3 seconds and use the saved copy.
function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(reject, 3000);
    fetch(request).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fromNetwork(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true })
          .then(saved => saved || (request.mode === "navigate" ? caches.match("index.html") : fetch(request)))
      )
  );
});
