// A new deploy without waiting out Pages' max-age=600: build.txt's 2nd line is the live page's stamp (build_site.py);
// on load, when the tab shows again and every few minutes, a stamp other than this page's reloads it, or offers to
// while something is being typed or a form is open (drafts stay: drafts.js, the batch). NOTES.md §29.
const PAGE = globalThis.document?.querySelector('meta[name="page"]')?.content || "";   // none: a dev copy (or node), no checks
const EVERY = 180e3, FAST = 15e3, FAST_FOR = 15 * 60e3;   // after a publish: every 15 s for 15 min
const TRIED = "fresh-tried";                               // the stamp a reload went for: never twice (a stale CDN copy)
let fastUntil = 0, timer = 0;

/** The live page's stamp, "" when unknown (offline, an old build.txt). */
export async function liveStamp() {
  try {
    const r = await fetch(`build.txt?t=${Date.now()}`, { cache: "no-store" });
    return r.ok ? ((await r.text()).split("\n")[1] || "").trim() : "";
  } catch { return ""; }
}
// typing, a form or editor open: offer instead of reloading
const busy = () => !!document.querySelector('[data-dirty="1"], .editing, #modal:not([hidden]) :is(form, textarea, input:not([type=checkbox]))')
  || !!document.activeElement?.matches?.('input:not([type=checkbox]), textarea, select, [contenteditable="true"]');

async function reload() {
  // the HTML is cached for 10 minutes too: refetch it, then reload (which revalidates it anyway)
  try { await fetch(location.href.split("#")[0], { cache: "reload" }); } catch { /* the reload still asks */ }
  location.reload();
}
function offer() {
  if (document.getElementById("fresh-bar")) return;
  const bar = document.createElement("div");
  bar.id = "fresh-bar"; bar.className = "edit-bar fresh-bar"; bar.setAttribute("role", "status");
  bar.innerHTML = `<div class="bar-head"><span>The site was updated.</span><button type="button" class="primary">Refresh</button></div>`;
  bar.querySelector("button").onclick = reload;   // a dirty form asks first (edit.js beforeunload); drafts flush on pagehide
  document.body.append(bar);
}
async function check() {
  if (!PAGE || document.visibilityState !== "visible") return;
  const live = await liveStamp();
  if (!live || live === PAGE) return;
  if (busy() || sessionStorage.getItem(TRIED) === live) { offer(); return; }
  sessionStorage.setItem(TRIED, live);
  reload();
}
function tick() {
  clearTimeout(timer);
  timer = setTimeout(() => check().finally(tick), Date.now() < fastUntil ? FAST : EVERY);
}
/** Start checking (app.js, once the data is in). */
export function watch() {
  if (!PAGE) return;
  check();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  tick();
}
/** Check every 15 s until 15 min after `at` (ms): a publish waiting for its build (edit.js). */
export function soon(at = Date.now()) {
  fastUntil = Math.max(fastUntil, at + FAST_FOR);
  if (PAGE && Date.now() < fastUntil) tick();
}
