/* Game Hub service worker – lets the hub open with no internet.
   - Pages: network first, then the saved copy, then offline.html.
   - Same-origin files: network first (so a new deploy shows up on the next open), then the saved copy.
   - Libraries / fonts from CDNs: served from the saved copy and refreshed in the background.
   - VERSION is stamped with the commit id on every deploy, so old caches are dropped automatically.
   - Never touches the PeerJS signalling server, EmailJS or connectivity probes. */
const VERSION = "gamehub-__BUILD__";        // replaced with the commit id by the deploy workflow
const SHELL = ["index.html", "offline.html", "404.html"];
const CDN_OK = ["www.gstatic.com", "unpkg.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.searchParams.has("_probe")) return;                       // connectivity checks must hit the network
  if (/peerjs\.com$|emailjs\.com$|metered\.ca$/.test(url.hostname)) return;
  if (url.origin === location.origin && url.pathname.endsWith("/version.json")) return;   // update checks always go to the network

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(url.origin + url.pathname, copy));
        }
        return res;
      }).catch(() =>
        caches.match(url.origin + url.pathname, { ignoreSearch: true })
          .then(r => r || caches.match("index.html", { ignoreSearch: true }))
          .then(r => r || caches.match("offline.html"))
      )
    );
    return;
  }

  if (url.origin === location.origin) {                              // our own files: network first (fresh after a deploy), saved copy offline
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error()))
    );
    return;
  }

  if (CDN_OK.includes(url.hostname)) {
    e.respondWith(
      caches.open(VERSION).then(cache =>
        cache.match(req).then(hit => {
          const net = fetch(req).then(res => {
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});
