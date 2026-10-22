// Offline support. Saves every file below on the device the first time the app opens online.
// When you add or rename a file: add it to FILES and bump the version in CACHE.
const CACHE = "brass-app-v23";
const FILES = [
  "./",
  "index.html",
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
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  // One missing file must not stop the whole update from installing.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(FILES.map(f => cache.add(f)))));
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
    // "no-cache" asks the server whether the file changed instead of trusting the browser's
    // 10-minute copy (GitHub Pages sends max-age=600), so a new version shows on the next load.
    fetch(new Request(request.url, { cache: "no-cache", credentials: "same-origin" })).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

// Store a copy, but never store a captive-portal page or an error over a good file.
function keep(event, request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fromNetwork(request)
      .then(response => {
        keep(event, request, response);
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true })
          .then(saved => saved || (request.mode === "navigate" ? caches.match("index.html") : fetch(request).then(late => { keep(event, request, late); return late; })))
      )
  );
});
