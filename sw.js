// Service worker for The Copper & Blue News app.
// - HTML pages and data JSON (data/, data.json, posts.json): network-first, so scores, the Live
//   tracker and news are never served stale while online; the cached copy is only an offline fallback.
// - Static assets (css, js, images, icons, fonts): cache-first. CSS/JS are versioned (?v=NN),
//   so bumping the version fetches fresh copies. Bump VERSION below when the precache list changes.
// - Offline: navigations fall back to the cached page, then offline.html.
// - Web push: shows Game alerts. A click opens that alert in the notifications inbox when the
//   payload has an id. The notification's own url is unchanged (lineup stays /players.html,
//   final stays /game.html?id=). Older notifications with no id still open their url.
const VERSION = "cbn-v48";
const STATIC = `${VERSION}-static`, PAGES = `${VERSION}-pages`, DATA = `${VERSION}-data`;
const PRECACHE = [
  "/offline.html", "/play.html", "/notifications.html", "/standings.html", "/leaders.html", "/article.html",
  "/js/play.js?v=48", "/js/airhockey-net.js?v=48", "/js/airhockey-online.js?v=48", "/js/home-play.js?v=48", "/js/config.js?v=48", "/copper.svg?v=48", "/css/style.css?v=48", "/js/main.js?v=48", "/js/pwa.js?v=48", "/js/newsletter.js?v=48",
  "/js/standings.js?v=48", "/js/leaders.js?v=48", "/js/inbox.js?v=48",
  "/js/article.js?v=48", "/js/article-render.js?v=48",
  "/audio/goal-horn.wav?v=48", "/audio/copper-aww.wav?v=48", "/audio/puck-clack.wav?v=48", "/audio/board-thud.wav?v=48",
  "/logo.jpg", "/icons/icon-192.png", "/icons/badge-96.png", "/favicon-32.png"
];
const DATA_MAX = 60;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

const isData = u => u.pathname.startsWith("/data/") || /^\/(data|posts)\.json$/.test(u.pathname) || u.pathname.endsWith(".webmanifest");
const isStatic = u => /\.(css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|wav|mp3)$/.test(u.pathname) && u.pathname !== "/sw.js" && !u.pathname.startsWith("/js/config.js");
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

async function trim(cacheName, max) {
  const c = await caches.open(cacheName), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
// Cache key without the cache-busting query (?t=...), so polling doesn't fill the cache.
const dataKey = u => u.origin + u.pathname;

async function networkFirst(event, cacheName, key, isNav) {
  const req = event.request;
  try {
    const res = (isNav && await event.preloadResponse) || await fetch(req);
    if (res && res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      event.waitUntil(caches.open(cacheName).then(c => c.put(key, copy)).then(() => cacheName === DATA && trim(DATA, DATA_MAX)));
    }
    return res;
  } catch (err) {
    const hit = await caches.match(key, {ignoreSearch: true});
    if (hit) return hit;
    if (isNav) return (await caches.match("/offline.html")) || Response.error();
    throw err;
  }
}
async function cacheFirst(event) {
  const req = event.request, hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.status === 200 || res.type === "opaque")) {
    const copy = res.clone();
    event.waitUntil(caches.open(STATIC).then(c => c.put(req, copy)));
  }
  return res;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname === "/sw.js") return;
    if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
      return event.respondWith(networkFirst(event, PAGES, u.origin + (u.pathname === "/" ? "/" : u.pathname), req.mode === "navigate"));
    }
    if (isData(u) || u.pathname === "/js/config.js") return event.respondWith(networkFirst(event, DATA, dataKey(u), false));
    if (isStatic(u)) return event.respondWith(cacheFirst(event));
    return; // anything else: plain network
  }
  if (FONT_HOSTS.includes(u.hostname)) return event.respondWith(cacheFirst(event));
  // Everything else cross-origin is NOT handled here, so it always goes straight to the network and is never
  // cached by this worker: the Instagram feed (feeds.behold.so), its images (behold.pictures, *.cdninstagram.com),
  // the alerts Worker (*.workers.dev), Cloudflare Web Analytics (static.cloudflareinsights.com beacon
  // and its cloudflareinsights.com/cdn-cgi/rum reports) and NHL assets.
});

// ---------- web push ----------
const sameOriginUrl = raw => {
  try { const u = new URL(raw || "/tracker.html", self.location.origin); return u.origin === self.location.origin ? u.href : null; } catch { return null; }
};
self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {body: event.data && event.data.text()}; }
  const title = d.title || "The Copper & Blue News";
  const opts = {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || d.id || undefined,
    renotify: d.renotify ?? !!(d.tag || d.id),
    timestamp: d.ts || Date.now(),
    data: {url: sameOriginUrl(d.url) || new URL("/tracker.html", self.location.origin).href, type: d.type || null, id: typeof d.id === "string" ? d.id.slice(0, 120) : null}
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  // Deep link to the inbox entry. data.url (lineup / final / live) is left as the alert sent it.
  const url = id
    ? new URL("/notifications.html?id=" + encodeURIComponent(id), self.location.origin).href
    : (data.url || new URL("/tracker.html", self.location.origin).href);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    for (const w of wins) {
      if (id && "postMessage" in w) w.postMessage({type: "cbn-open-alert", id});
      if (new URL(w.url).pathname === new URL(url).pathname && "focus" in w) { if ("navigate" in w && w.url !== url) await w.navigate(url).catch(() => {}); return w.focus(); }
    }
    for (const w of wins) if ("focus" in w && "navigate" in w) { await w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  })());
});
// If the browser rotates the push subscription, the next visit to the alerts panel re-registers it.
