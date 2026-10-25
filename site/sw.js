// The site's service worker (build_site.py writes it to the site root with the pictures in use; app.js registers it).
// It keeps the card pictures and type icons, whose file names name their content (thumbs/<blob>-<width>-<tag>.avif,
// icons/<name>.<stamp>[.<variant>].webp: an old URL gets its own picture or a 404, never another one), so a returning
// visitor doesn't download them again after a deploy (Pages re-dates every file and caches 10 minutes). Every other request (pages, data, scripts) goes to the network untouched, as without a
// worker. A deploy that changes a picture changes this file: the new worker takes over at once (every version serves
// the same immutable URLs) and deletes what the site no longer uses. Bump CACHE when what it keeps changes.
const CACHE = "pictures-1", PREFIX = "pictures-";
// the build's: the pictures the site uses, 10 hex digits each (a blob's first ten, an icon's stamp); none: keep everything
const IN_USE = new Set(/*PICTURES*/"".match(/[0-9a-f]{10}/g));
// the build's thumb settings tags, 6 hex digits each (build_site.py thumb_tag); none: any
const TAGS = new Set(/*TAGS*/"".match(/[0-9a-f]{6}/g));
const SCOPE = new URL(self.registration.scope).pathname;
const THUMB = /^thumbs\/([0-9a-f]{16})-(?:240|360|720)-([0-9a-f]{6})\.avif$/;
const ICON = /^icons\/[a-z0-9-]+\.([0-9a-f]{10})(?:\.(?:tint|sticker|glow|darkglow))?\.webp$/;

/** The picture's content name (blob or stamp) when this URL is one the worker keeps, else "" */
function nameOf(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE) || url.search) return "";
  const rel = url.pathname.slice(SCOPE.length);
  const t = THUMB.exec(rel);
  if (t) return !TAGS.size || TAGS.has(t[2]) ? t[1].slice(0, 10) : "";
  const i = ICON.exec(rel);
  return i ? i[1] : "";
}
const inUse = name => !!name && (!IN_USE.size || IN_USE.has(name));
const keepable = res => res.status === 200 && res.type === "basic";

async function picture(event, url) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url.href);      // by URL alone: an <img>, a preload and a CSS mask of one picture share it
    if (hit) return hit;
  } catch { cache = null; /* no storage: the network */ }
  const res = await fetch(event.request);
  if (cache && keepable(res) && inUse(nameOf(url))) event.waitUntil(cache.put(url.href, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener("install", event => {
  // everything but thumbs/ and icons/ (pages, data, scripts) straight to the network without starting this worker:
  // a stopped worker otherwise starts for each page load (Chrome's static routing; elsewhere the fetch handler skips them)
  if (event.addRoutes && self.URLPattern) event.waitUntil(event.addRoutes({ condition: { not: { or: ["thumbs/*", "icons/*"].map(p =>
    ({ urlPattern: new URLPattern({ pathname: SCOPE + p }) })) } }, source: "network" }).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
  if (IN_USE.size) {
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) if (!inUse(nameOf(new URL(request.url)))) await cache.delete(request);
  }
  await self.clients.claim();
})().catch(() => {})));

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (nameOf(url)) event.respondWith(picture(event, url));
});

// app.js, once this worker controls the page: {seen: [picture URLs the page loaded before]}, put in from the browser's
// HTTP cache (no new download)
self.addEventListener("message", event => {
  const seen = Array.isArray(event.data?.seen) ? event.data.seen.slice(0, 5000) : [];
  if (!seen.length) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const href of seen) {
      let url;
      try { url = new URL(href); } catch { continue; }
      if (!inUse(nameOf(url)) || await cache.match(url.href)) continue;
      try {
        const res = await fetch(url.href);
        if (keepable(res)) await cache.put(url.href, res);
      } catch { /* offline: kept on its next load */ }
    }
  })().catch(() => {}));
});
