// Offline support. Saves every file below on the device the first time the app opens online.
// When you add or rename a file: add it to FILES and bump the version in CACHE.
const CACHE = "tonebee-v51";
const FILES = [
  "./",
  "index.html",
  "icons/inst/trumpet.png",
  "icons/inst/trombone.png",
  "icons/inst/horn.png",
  "icons/inst/sax.png",
  "icons/inst/flute.png",
  "icons/inst/clarinet.png",
  "icons/inst/recorder.png",
  "ramzor.html",
  "sound-game.html",
  "right-note.html",
  "horn-ladder.html",
  "ninja.html",
  "songs.html",
  "sounds/horn/Bb3.m4a",
  "sounds/horn/D4.m4a",
  "sounds/horn/E4.m4a",
  "sounds/horn/G3.m4a",
  "sounds/trumpet/A4.m4a",
  "sounds/trumpet/Bb3.m4a",
  "sounds/trumpet/Bb4.m4a",
  "sounds/trumpet/C4.m4a",
  "sounds/trumpet/D4.m4a",
  "sounds/trumpet/Eb4.m4a",
  "sounds/trumpet/F4.m4a",
  "sounds/trumpet/G4.m4a",
  "sounds/trombone/A3.m4a",
  "sounds/trombone/Bb2.m4a",
  "sounds/trombone/Bb3.m4a",
  "sounds/trombone/C3.m4a",
  "sounds/trombone/D3.m4a",
  "sounds/trombone/Eb3.m4a",
  "sounds/trombone/F3.m4a",
  "sounds/trombone/G3.m4a",
  "sounds/horn/F2.m4a",
  "sounds/horn/C3.m4a",
  "sounds/horn/F3.m4a",
  "sounds/horn/A3.m4a",
  "sounds/horn/C4.m4a",
  "sounds/horn/Eb4.m4a",
  "sounds/horn/F4.m4a",
  "sounds/horn/G4.m4a",
  "sounds/horn/A4.m4a",
  "sounds/horn/C5.m4a",
  "balloon-breath.html",
  "buzz-along.html",
  "clap-along.html",
  "note-names.html",
  "manifest.json",
  "fonts/fonts.css",
  "fonts/rubik-hebrew.woff2",
  "fonts/rubik-latin.woff2",
  "fonts/Bravura.woff2",
  "fonts/lexend-400-700-latin.woff2",
  "fonts/atkinson-hyperlegible-400-latin.woff2",
  "fonts/atkinson-hyperlegible-700-latin.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/tiles/ramzor.webp",
  "icons/tiles/breath.webp",
  "icons/tiles/buzz.webp",
  "icons/tiles/long.webp",
  "icons/tiles/right.webp",
  "icons/tiles/ladder.webp",
  "icons/tiles/ninja.webp",
  "icons/tiles/songs.webp",
  "icons/tiles/names.webp",
  "icons/tiles/clap.webp",
  "icons/sprites/rocket.webp",
  "icons/sprites/chute.webp",
  "icons/sprites/bee.webp",
  "icons/sprites/monkey-head.webp",
  "icons/sprites/banana.webp",
  "icons/sprites/ninja.webp",
  "icons/sprites/plane.webp",
  "icons/sprites/cloud.webp",
  "icons/sprites/house.webp",
  "icons/sprites/tree.webp",
  "icons/sprites/flower-0.webp",
  "icons/sprites/flower-1.webp",
  "icons/sprites/flower-2.webp",
  "icons/sprites/flower-3.webp",
  "icons/sprites/flower-4.webp"
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// One file into the new cache: from the internet, or else the copy an older version saved, so a file that fails
// to download during an update is not lost when activate deletes the old cache.
function fill(cache, f) {
  return cache.add(f).catch(() => caches.match(f, { ignoreSearch: true }).then(old => old && cache.put(f, old)));
}

self.addEventListener("install", event => {
  // One missing file must not stop the whole update from installing.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(FILES.map(f => fill(cache, f)))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.open(CACHE)
      // Whatever is still missing gets one more try (at most 5 s: pages wait for this), then the old caches go.
      .then(cache => Promise.race([wait(5000), Promise.allSettled(FILES.map(f => cache.match(f).then(hit => hit || fill(cache, f))))]))
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Gives up waiting after 3 seconds; the download itself goes on (and is still saved when it arrives).
function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(reject, ms);
    promise.then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

// Store a copy, but never a captive-portal page or an error over a good file, and never into a cache that a newer
// version has already deleted. One copy per file: the address without ?lang= / ?t= / ?next=.
function keep(key, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const copy = response.clone();
  return caches.has(CACHE).then(ok => ok && caches.open(CACHE).then(cache => cache.put(key, copy))).catch(() => {});
}

// Try the internet first (so updates show up), give up after 3 seconds and use the saved copy. An error page
// (404, 5xx) counts as no answer when there is a saved copy.
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  // "no-cache" asks the server whether the file changed instead of trusting the browser's own short-lived copy.
  const net = fetch(new Request(request.url, { cache: "no-cache", credentials: "same-origin" }));
  event.waitUntil(net.then(response => keep(request.url.split(/[?#]/)[0], response), () => {}));
  const saved = () => caches.match(request, { ignoreSearch: true });
  event.respondWith(
    within(net, 3000)
      .then(response => response.ok ? response : saved().then(copy => copy || response))
      .catch(() => saved()
        .then(copy => copy || (request.mode === "navigate" ? caches.match("index.html") : null))
        .then(copy => copy || net))
  );
});
