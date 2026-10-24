// Card image previews in edit mode: the quick mock-up (mockup.js, drawn in the browser) and the rendered preview, a dry-run
// bake of the card's PSD-kind fields by the card repo's card-preview.yml (AutoCroissant commands/card_preview.py; the
// contract in site/NOTES.md section 19: workflow_dispatch with card, edit and request, the result on the orphan branch
// "previews"). The site starts it with the signed-in editor's token, remembers each request in localStorage (the last
// KEEP per card), checks every POLL_MS in the background (for up to MAX_WAIT_MS) while the editor works on other cards,
// badges a card whose preview is ready and shows it when the card is opened again: beside the current image (with a
// diff), or why the bake would refuse it. Pure helpers above createPreviews.
import { esc } from "./text.js";
import { sameField, value, psdValue } from "./edit.js";
import * as mockup from "./mockup.js";

/** The Action's side, in one place: change it here if card-preview.yml's inputs or files change. */
export const CONTRACT = {
  workflow: "card-preview.yml", ref: "main", branch: "previews",
  inputs: (card, edit, request) => ({ card: card.key, edit: JSON.stringify(edit), request }),
  result: request => `previews/${request}/result.json`,
  file: (request, name) => `previews/${request}/${name}`,
};
export const KEY = "card-previews";                   // localStorage: {card id: [entry, newest first]}
export const KEEP = 3, POLL_MS = 15000, MAX_WAIT_MS = 20 * 60000, MAX_EDIT = 16384;   // MAX_EDIT: card_preview's, bytes of edit JSON
export const PSD_FIELDS = ["name", "stars", "types", "hp", "def", "atk", "spd", "ability"];   // printed on the card (edit.js FROM "PSD")
export const ENTRY_FIELDS = [...PSD_FIELDS, "creatures"];                                  // what the edit carries (creatures gates a stat bake)
export const DONE = ["baked", "redundant", "refused", "error"];                            // result.json states
const REQUEST_RE = /^[A-Za-z0-9-]{8,64}$/;            // card-preview.yml's check
const STATS = ["hp", "def", "atk", "spd"];
const LABEL = { name: "Name", stars: "Stars", types: "Types", hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", ability: "Text", creatures: "Creatures" };

const text = v => String(v ?? "").replace(/\r/g, "").trim();
/** The edit a preview sends: the PSD-kind fields (and creatures) of the card's Card Edits.json entry as Publish would leave
 *  it (fields: its field names; get(f): the value), in Card Edits.json shapes. All of them, not only the changed ones:
 *  the bake bakes the committed ones too. */
export function entryEdit(fields, get) {
  const out = {};
  for (const f of ENTRY_FIELDS) {
    if (!fields.includes(f)) continue;
    const v = get(f);
    if (f === "creatures" ? !(Array.isArray(v) && v.length > 1) : v === undefined) continue;
    out[f] = f === "types" ? [...(v || [])] : typeof v === "string" ? text(v) : v;
  }
  return out;
}
/** The PSD fields whose value (cur) isn't what the PSD prints (psd): what the image would change by, the mock-up's and the
 *  panel's. Stats cleared to nothing are never baked; text compares trimmed, types in any order. */
export function changedOf(cur, psd) {
  const out = {};
  for (const f of PSD_FIELDS) {
    const v = cur[f];
    if (v === undefined || ((STATS.includes(f) || f === "stars") && v == null)) continue;
    const same = typeof v === "string" || typeof psd[f] === "string" ? text(v) === text(psd[f]) : sameField(f, v ?? null, psd[f] ?? null);
    if (!same) out[f] = v;
  }
  return out;
}
/** An edit as JSON with sorted keys and sorted types: the same edit is the same text (the contract's comparison). */
export const canonical = edit => JSON.stringify(Object.fromEntries(Object.keys(edit).sort().map(f => [f, f === "types" && Array.isArray(edit[f]) ? [...edit[f]].sort() : edit[f]])));
/** A short hash of canonical(edit) (cyrb53, hex). */
export function hashOf(edit) {
  const s = canonical(edit);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
/** A request id: login, time, random (the Action takes 8-64 of A-Z a-z 0-9 -: the folder of its result). */
export function newRequest(login, now = Date.now(), rand = Math.random()) {
  const who = String(login || "editor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39) || "editor";
  return `${who}-${now.toString(36)}-${Math.floor(rand * 36 ** 4).toString(36).padStart(4, "0")}`;
}
export const validRequest = r => typeof r === "string" && REQUEST_RE.test(r);
/** result.json (AutoCroissant card_preview) as {state, transient, reason, notes[], fields{}, changes[], base{}, image,
 *  files{}, run}; anything unreadable is an "error" saying so. Strings stay raw: the HTML escapes them. */
export function readResult(raw) {
  let r = raw;
  const bad = reason => ({ state: "error", transient: true, reason, notes: [], fields: {}, changes: [], base: {}, image: null, files: {}, run: "" });
  if (typeof raw === "string") { try { r = JSON.parse(raw); } catch { return bad("The preview's result file isn't valid JSON"); } }
  if (!r || typeof r !== "object" || !DONE.includes(r.state)) return bad("The preview's result file has no known state");
  const clip = v => String(v).slice(0, 500), obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const notes = (Array.isArray(r.notes) ? r.notes : r.notes ? [r.notes] : []).filter(n => n != null && n !== "").slice(0, 20).map(n => clip(typeof n === "string" ? n : JSON.stringify(n)));
  const base = Object.fromEntries(Object.entries(obj(r.base)).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v.slice(0, 64)]));
  const files = Object.fromEntries(Object.entries(obj(r.files)).filter(([k, v]) => ["webp", "png"].includes(k) && typeof v === "string" && /^[\w.-]+\.(webp|png)$/i.test(v)));
  const fields = Object.fromEntries(Object.entries(obj(r.fields)).filter(([k, v]) => k in LABEL && typeof v === "string").map(([k, v]) => [k, v.slice(0, 20)]));
  const changes = (Array.isArray(r.changes) ? r.changes : []).filter(x => x && typeof x === "object" && typeof x.field === "string").slice(0, 12)
    .map(x => ({ field: x.field, old: x.old, new: x.new }));
  return { state: r.state, transient: r.transient === true, reason: r.reason ? clip(r.reason) : "", notes, fields, changes, base,
    image: r.image === "baked" || r.image === "refused" ? r.image : null, files, run: typeof r.run === "string" && /^https:\/\/github\.com\//.test(r.run) ? r.run : "" };
}
/** The store read from localStorage text: only well-formed entries, newest first, KEEP per card. */
export function readStore(textValue) {
  let s; try { s = JSON.parse(textValue); } catch { s = null; }
  const out = {};
  if (!s || typeof s !== "object" || Array.isArray(s)) return out;
  for (const [id, list] of Object.entries(s)) {
    const ok = (Array.isArray(list) ? list : []).filter(e => e && typeof e === "object" && validRequest(e.request) && typeof e.at === "number" && typeof e.hash === "string");
    if (ok.length) out[id] = ok.sort((a, b) => b.at - a.at).slice(0, KEEP);
  }
  return out;
}
/** store with entry added (or replaced, same request) at the front of its card's list, the list cut to KEEP. */
export function remember(store, entry, keep = KEEP) {
  const list = (store[entry.card] || []).filter(e => e.request !== entry.request);
  return { ...store, [entry.card]: [entry, ...list].sort((a, b) => b.at - a.at).slice(0, keep) };
}
/** store with changes merged into the entry of that request. */
export function patch(store, request, changes) {
  const out = { ...store };
  for (const [id, list] of Object.entries(store)) if (list.some(e => e.request === request)) out[id] = list.map(e => (e.request === request ? { ...e, ...changes } : e));
  return out;
}
/** The entries still waiting for their result; past their wait (MAX_WAIT_MS) expire() makes them "timeout". */
export const waiting = store => Object.values(store).flat().filter(e => e.state === "running");
export function expire(store, now = Date.now()) {
  let out = store;
  for (const e of waiting(store)) if (now - e.at > (e.wait || MAX_WAIT_MS)) out = patch(out, e.request, { state: "timeout" });
  for (const e of Object.values(store).flat()) if (e.state === "starting" && now - e.at > 60000) out = patch(out, e.request, { state: "error", error: "It didn't start: the page closed first.", seen: true });
  return out;
}
/** Why a preview no longer shows the card as it would be baked: [] or reasons. "edit": the fields the site would send
 *  now differ; "psd": the card's image changed since (the result's PNG blob, cards.json img being its first 16 hex
 *  digits; before a result, the card's ts and img at the dispatch). */
export function staleWhy(entry, card, hash) {
  const why = [];
  if (entry.hash !== hash) why.push("edit");
  const png = entry.result?.base?.png_blob;
  const moved = png && card.img ? !png.startsWith(card.img)
    : !!entry.base && ((entry.base.ts ?? null) !== (card.ts ?? null) || (entry.base.img ?? null) !== (card.img ?? null));
  if (moved) why.push("psd");
  return why;
}
/** The tile badge's tip for a result. */
export const badgeTip = state => ({ baked: "Its preview image is ready", redundant: "Its preview: already on the card", refused: "Its preview: the bake would refuse it",
  error: "Its preview failed" }[state] || "Its preview") + ": open the card";
/** Does the card's tile get the "Preview" badge: its newest preview has a result not seen yet. */
export const hasNews = (store, id) => { const e = (store[id] || [])[0]; return !!e && DONE.includes(e.state) && !e.seen; };
/** What to say when the run can't start: the dispatch's status (0: GitHub unreachable), GitHub's message, the token's
 *  classic scopes (null: unknown, a fine-grained token), installed: the workflow file is on the card repo. */
export function startProblem(status, message = "", { scopes = null, installed = true } = {}) {
  if (!installed) return `The preview Action isn't set up on the card repo yet (no .github/workflows/${CONTRACT.workflow} on ${CONTRACT.ref}).`;
  const scope = "A preview runs an Action, which needs a classic token with the repo scope or a fine-grained one with Actions: Read and write. Make one in GitHub's Settings → Developer settings, then sign in with it.";
  if (status === 401) return "Your sign-in no longer works (the token expired or was deleted): sign in again.";
  if (status === 403 || status === 404) return `${scopes != null && !/(^|[\s,])repo([\s,]|$)/.test(scopes) ? "Your token has only the public_repo scope. " : "Your token can't start Actions. "}${scope}`;
  if (status === 422) return `GitHub refused the preview run${message ? `: ${message}` : ""}.`;
  if (!status) return `Couldn't reach GitHub${message ? ` (${message})` : ""}. Try again in a minute.`;
  return `GitHub said ${status}${message ? `: ${message}` : ""}.`;
}
/** Can this token start Actions, as far as its classic scopes tell: true, false (no repo scope) or null (unknown). */
export const scopeOk = scopes => (scopes == null ? null : /(^|[\s,])repo([\s,]|$)/.test(scopes));
/** "just now", "4 min ago", "2 h ago". */
export function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
/** The diff of two same-sized RGBA images: changed pixels red over a dimmed a. {data, changed (0-1)}. */
export function diffPixels(a, b, threshold = 48) {
  const out = new Uint8ClampedArray(a.length);
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > threshold) { out[i] = 255; out[i + 1] = 40; out[i + 2] = 40; n++; }
    else { out[i] = a[i] * 0.3; out[i + 1] = a[i + 1] * 0.3; out[i + 2] = a[i + 2] * 0.3; }
    out[i + 3] = 255;
  }
  return { data: out, changed: a.length ? n / (a.length / 4) : 0 };
}
/** One line naming what an edit holds: "Name, Text, HP". */
export const fieldsLine = edit => ENTRY_FIELDS.filter(f => f in edit).map(f => LABEL[f]).join(", ");
/** Each field's outcome from result.json: "Name baked · Stars refused". */
export const outcomesLine = fields => Object.entries(fields || {}).map(([f, how]) => `${LABEL[f] || f} ${how}`).join(" · ");
const STATE_TEXT = {
  running: "Baking a preview", baked: "Preview ready", redundant: "Nothing to bake", refused: "The bake would refuse this",
  error: "The preview failed", timeout: "No result yet", starting: "Starting",
};
/** The rendered preview's part of the panel for the newest entry e (or none). v: {card, n (fields the image would change
 *  by), hash, now, scopes, images (preview URLs: the 720 px WebP, the full PNG), current (the current image's URL), diff}. */
export function renderedHtml(e, v) {
  const button = (label, cls = "") => `<button type="button" class="${cls}" data-pv="start"${v.n ? "" : " disabled"}>${label}</button>`;
  const scopeNote = scopeOk(v.scopes) === false ? `<p class="muted pv-note">Your token has only the public_repo scope; starting a preview needs the repo scope (or a fine-grained token with Actions: Read and write).</p>` : "";
  if (!e) {
    return `<p class="muted">${v.n ? "A dry-run bake draws your edit into the card image as the bake would, and saves nothing. It takes a few minutes: open other cards meanwhile, and come back." : "No changes on the card image to preview."}</p>
      ${scopeNote}<div class="actions">${button("Preview image", "primary")}</div>`;
  }
  const r = e.result || {}, stale = DONE.includes(e.state) ? staleWhy(e, v.card, v.hash) : [];
  const staleText = stale.length ? `<p class="pv-stale" role="note">Out of date: ${stale.map(w => (w === "edit" ? "the edit changed since" : "the card changed since")).join(" and ")}. ${button("Preview again", "ghost")}</p>` : "";
  const head = `<p class="pv-state" data-state="${esc(e.state)}"><b>${esc(STATE_TEXT[e.state] || e.state)}</b> · ${esc(fieldsLine(e.edit || {}))} · <span class="muted">${esc(ago(v.now - e.at))}</span></p>`;
  const outcomes = r.fields && Object.keys(r.fields).length ? `<p class="pv-fields">${esc(outcomesLine(r.fields))}</p>` : "";
  const notes = r.notes?.length ? `<ul class="pv-notes">${r.notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const run = r.run || e.run?.url, runLink = run ? ` <a href="${esc(run)}" target="_blank" rel="noopener">The run on GitHub</a>.` : "";
  const again = stale.length ? "" : button("Preview again", "ghost");
  if (e.state === "starting" || e.state === "running") {
    return `${head}<p class="muted" aria-live="polite"><span class="pv-spin" aria-hidden="true"></span> The Action is drawing it; checked every ${POLL_MS / 1000} s, up to ${MAX_WAIT_MS / 60000} min.${runLink}</p>`;
  }
  const pair = (label, alt) => {
    const [src, full] = v.images, diff = v.diff && !!v.current;
    return `<div class="pv-pair${diff ? " diff" : ""}">
        ${v.current ? `<figure><img src="${esc(v.current)}" alt="${esc(v.card.name)}, current image" crossorigin="anonymous" data-pv-img="current"><figcaption>Current</figcaption></figure>` : ""}
        <figure><a href="${esc(full || src)}" target="_blank" rel="noopener" title="Full size"><img src="${esc(src)}" alt="${esc(v.card.name)}, ${esc(alt)}" crossorigin="anonymous" data-pv-img="preview" data-fallback="${esc(full || "")}"></a><figcaption>${label}</figcaption></figure>
        ${v.current ? `<figure class="pv-diff"${diff ? "" : " hidden"}><canvas data-pv-diff role="img" aria-label="Differences between the current image and the preview, in red"></canvas><figcaption>Differences in red <span class="muted" data-pv-changed></span></figcaption></figure>` : ""}
      </div>
      <div class="actions">${v.current ? `<button type="button" class="ghost" data-pv="diff" aria-pressed="${diff}">Diff</button>` : ""}${full ? `<a class="fact" href="${esc(full)}" target="_blank" rel="noopener">Full size</a>` : ""}${again}</div>`;
  };
  if (e.state === "baked" && v.images.length) return `${head}${staleText}${pair(`Preview <span class="muted">(dry run)</span>`, "rendered preview")}${outcomes}${notes}`;
  if (e.state === "redundant") return `${head}${staleText}<p>Already on the card: a bake would change nothing.</p>${outcomes}${notes}`;
  if (e.state === "refused") {
    return `${head}${staleText}<p>${esc(r.reason || "The bake refused this edit.")}</p>${r.image === "refused" && v.images.length ? pair(`What the bake drew before refusing it`, "the bake's render before it refused") : `<div class="actions">${again}</div>`}${outcomes}${notes}`;
  }
  if (e.state === "timeout") return `${head}<p>No result after ${MAX_WAIT_MS / 60000} minutes.${runLink} The run may still finish.</p><div class="actions"><button type="button" class="ghost" data-pv="recheck">Check again</button>${button("Preview again", "ghost")}</div>`;
  const input = /^input:/.test(r.reason || "");
  const why = input ? `The bake couldn't read what the website sent (a website bug): ${r.reason}` : r.reason || e.error || "Something went wrong.";
  return `${head}<p class="err">${esc(why)}</p>${r.transient ? `<p class="muted">Usually passing: try again.</p>` : ""}${notes}${runLink ? `<p>${runLink}</p>` : ""}${e.error ? scopeNote : ""}<div class="actions">${button("Try again", "ghost")}</div>`;
}
/** The older previews of a card, as buttons to show one: entries after the first. */
export const olderHtml = (list, now, shown) => (list.length > 1 ? `<p class="muted pv-older">Earlier: ${list.map((e, i) => `<button type="button" class="ghost" data-pv-show="${i}" aria-pressed="${i === shown}">${i ? esc(ago(now - e.at)) : "newest"} · ${esc(STATE_TEXT[e.state] || e.state)}</button>`).join(" ")}</p>` : "");

export function createPreviews(app) {
  // app: {S, editor (me, github(path, opts), scopes, psdOf(id)), toast, loadDetails(c), getJson(name), signIn(note),
  // badges() (re-mark the grid's tiles)}
  const { S } = app;
  let store = readStore(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full: this page only */ } };
  const set = s => { store = s; save(); };
  const live = new Set();                             // the open panels: {id, host, paint}
  const notify = id => { app.badges(); for (const p of [...live]) { if (!p.host.isConnected) live.delete(p); else if (id == null || p.id === id) p.paint(); } };
  window.addEventListener("storage", e => { if (e.key === KEY) { store = readStore(e.newValue); notify(null); } });   // another tab
  const repo = () => S.data.repo;
  const rawUrl = (ref, path) => `https://raw.githubusercontent.com/${repo()}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const imagesOf = e => [e.result?.files?.webp, e.result?.files?.png].filter(Boolean).map(f => rawUrl(CONTRACT.branch, CONTRACT.file(e.request, f)));   // the 720 px WebP, the full PNG
  const current = c => (c.img ? `thumbs/${c.img}-720.webp` : "");

  // ---- the values: the card's (published + staged) or the open form's, against the PSD's
  const psdOf = c => app.editor.psdOf(c.id) || {};
  // v: {edit (sent), hash, n (fields the image would change by), cur (every PSD field's value), psd}
  const values = (cur, psd, edit) => ({ edit, hash: hashOf(edit), n: Object.keys(changedOf(cur, psd)).length, cur, psd });
  const cardV = c => { const cur = Object.fromEntries(PSD_FIELDS.map(f => [f, value(c, f, S.byId)]));   // published + staged
    return values(cur, psdOf(c), entryEdit(app.editor.entryFields(c.id), f => value(c, f, S.byId))); };
  const formV = (c, op, base) => {                    // the open form's, relative to the published card (base)
    const get = f => (f in op.set ? op.set[f] : (op.unset || []).includes(f) ? psdValue(base, f, S.byId) : value(base, f, S.byId));
    return values(Object.fromEntries(PSD_FIELDS.map(f => [f, get(f)])), psdOf(c), entryEdit(app.editor.entryFields(c.id, op), get));
  };

  // ---- starting one
  async function start(c, edit) {
    const ed = app.editor;
    if (!ed.me) { app.signIn(`Sign in to preview ${c.name}'s image.`); return; }
    if (!Object.keys(edit).length) { app.toast("No changes on the card image to preview"); return; }
    if (JSON.stringify(edit).length > MAX_EDIT) { app.toast("This edit is over 16 KB: the preview takes less"); return; }
    const request = newRequest(ed.me.login), entry = { card: c.id, key: c.key, name: c.name, request, edit, hash: hashOf(edit), base: { ts: c.ts ?? null, img: c.img ?? null }, at: Date.now(), state: "starting" };
    set(remember(store, entry)); notify(c.id);
    try {
      let installed = true;
      try { await ed.github(`/repos/${repo()}/actions/workflows/${CONTRACT.workflow}`); }
      catch (e) { if (e.status === 404) installed = false; else if (!e.status) throw e; }
      if (!installed) throw Object.assign(new Error(startProblem(404, "", { installed: false })), { shown: true });
      await ed.github(`/repos/${repo()}/actions/workflows/${CONTRACT.workflow}/dispatches`, { method: "POST", body: { ref: CONTRACT.ref, inputs: CONTRACT.inputs(c, edit, request) } });
      set(patch(store, request, { state: "running" }));
      app.toast(`Preview started for ${c.name}: it takes a few minutes`);
    } catch (e) {
      const why = e.shown ? e.message : startProblem(e.status || 0, String(e.message || "").replace(/^GitHub \d+: ?/, ""), { scopes: ed.scopes });
      set(patch(store, request, { state: "error", error: why, seen: true }));   // said at once: no badge
      app.toast("The preview didn't start");
    }
    notify(c.id); schedule(POLL_MS);
  }

  // ---- the background check: every POLL_MS while any is running, from any page
  let timer = null, busy = false;
  function schedule(ms = POLL_MS) {
    if (timer || !waiting(store).length) return;
    timer = setTimeout(() => { timer = null; poll().finally(() => schedule()); }, ms);
  }
  async function fetchResult(e) {                     // the result text, or null while there is none
    try { return await app.editor.github(`/repos/${repo()}/contents/${CONTRACT.result(e.request).split("/").map(encodeURIComponent).join("/")}?ref=${CONTRACT.branch}`, { raw: true }); }
    catch (err) { if (err.status === 404) return null; throw err; }
  }
  async function findRun(e) {                         // the dispatched run, when its title names the request (run-name)
    const since = new Date(e.at - 120000).toISOString().replace(/\.\d+Z$/, "Z");
    const r = await app.editor.github(`/repos/${repo()}/actions/workflows/${CONTRACT.workflow}/runs?event=workflow_dispatch&per_page=30&created=%3E%3D${since}`);
    const run = (r.workflow_runs || []).find(x => String(x.display_title || x.name || "").includes(e.request));
    return run ? { id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion } : null;
  }
  async function poll(only = null) {
    if (busy || !app.editor.me) return;
    busy = true;
    try {
      set(expire(store));
      for (const e of only ? [only] : waiting(store)) {
        let raw = null;
        try { raw = await fetchResult(e); } catch { continue; }                 // GitHub unreachable: next time
        if (raw != null) {
          const result = readResult(raw);
          set(patch(store, e.request, { state: result.state, result, done: Date.now() }));
          app.toast(`${result.state === "baked" ? "Preview ready" : "Preview finished"}: ${e.name}`);
          notify(e.card);
          continue;
        }
        if (Date.now() - (e.runAt || e.at) < 60000) continue;               // the run: looked up once a minute
        const run = await findRun(e).catch(() => null);
        set(patch(store, e.request, { runAt: Date.now() }));
        if (run) {
          set(patch(store, e.request, { run }));
          if (run.status === "completed" && run.conclusion !== "success" && e.run?.status === "completed") {   // seen finished twice, still no result
            set(patch(store, e.request, { state: "error", error: `The preview run ended (${run.conclusion}) without a result.` }));
            notify(e.card);
          }
        }
      }
    } finally { busy = false; }
  }

  // ---- marks: the grid's badges, the card page's panel, the Edit dialog's aside
  function mountTiles(root) {
    for (const t of root.querySelectorAll(".tile[data-open]")) {
      const id = t.dataset.open, on = hasNews(store, id), b = t.querySelector(".pv-badge");
      if (on && !b) t.insertAdjacentHTML("beforeend", `<span class="pv-badge" data-tip="${esc(badgeTip(store[id][0].state))}">Preview</span>`);
      else if (!on && b) b.remove();
    }
  }
  const views = new Map();                            // card id -> {mode, diff, shown}: the panel's toggles while the page lives
  function panelHtml(c, v, where) {
    const list = store[c.id] || [], st = views.get(c.id) || {}, shown = Math.min(st.shown || 0, Math.max(0, list.length - 1)), e = list[shown];
    const n = v.n, mode = st.mode || (e && DONE.includes(e.state) && where === "card" ? "rendered" : n ? "mockup" : "rendered");
    const seg = m => `<button type="button" data-pv-mode="${m}" aria-pressed="${mode === m}">${m === "mockup" ? "Mock-up" : "Rendered"}</button>`;
    const news = hasNews(store, c.id) ? ` <span class="pv-badge inline">New</span>` : "";
    return `<section class="pv-panel" data-pv-card="${esc(c.id)}" aria-label="Card image preview">
      <div class="pv-head"><h3>Image with your edit${news}</h3><div class="seg" role="group" aria-label="Preview kind">${seg("mockup")}${seg("rendered")}</div></div>
      <div class="pv-body" data-mode="${mode}">
        ${mode === "mockup" ? (n && c.img ? `<figure class="pv-mock"><canvas data-pv-mock role="img" aria-label="Mock-up of ${esc(c.name)} with your edit"></canvas><span class="pv-ribbon" aria-hidden="true">Mock-up</span>
          <figcaption>${esc(mockup.LABEL)}. <span class="muted" data-pv-mock-note></span></figcaption></figure>
          ${e && (e.state === "starting" || e.state === "running") ? "" : `<div class="actions"><button type="button" data-pv="start">Preview image</button></div>`}` : `<p class="muted">${c.img ? "No changes on the card image yet." : "This card has no image to draw on."}</p>`)
          : renderedHtml(e, { ...v, card: c, now: Date.now(), images: e ? imagesOf(e) : [], current: current(c), diff: st.diff, scopes: app.editor.scopes }) + olderHtml(list, Date.now(), shown)}
      </div></section>`;
  }
  function wire(root, c, getV, where) {               // (re)render a panel in root and its listeners
    const host = root.querySelector(".pv-host");
    const paint = () => {
      const v = getV();
      host.innerHTML = panelHtml(c, v, where);
      const canvas = host.querySelector("[data-pv-mock]");
      if (canvas) drawMock(canvas, c, v, host);
      const pair = host.querySelector(".pv-pair");
      if (pair) wirePair(pair);
      const e = (store[c.id] || [])[0];
      if (where === "card" && e && DONE.includes(e.state) && !e.seen && host.querySelector(".pv-body").dataset.mode === "rendered") { set(patch(store, e.request, { seen: true })); app.badges(); }
    };
    host.onclick = ev => {
      const t = sel => ev.target.closest(sel);
      if (t("[data-pv-mode]")) { views.set(c.id, { ...views.get(c.id), mode: t("[data-pv-mode]").dataset.pvMode }); paint(); return; }
      if (t("[data-pv-show]")) { views.set(c.id, { ...views.get(c.id), shown: +t("[data-pv-show]").dataset.pvShow }); paint(); return; }
      const act = t("[data-pv]")?.dataset.pv;
      if (act === "start") { views.set(c.id, { ...views.get(c.id), mode: "rendered", shown: 0 }); start(c, getV().edit); }
      else if (act === "diff") { const st = views.get(c.id) || {}; views.set(c.id, { ...st, diff: !st.diff }); paint(); }
      else if (act === "recheck") { const e = (store[c.id] || [])[0]; if (e) { set(patch(store, e.request, { state: "running", wait: Date.now() - e.at + 10 * 60000 })); notify(c.id); poll(store[c.id][0]).then(() => notify(c.id)); schedule(); } }
    };
    paint();
    live.add({ id: c.id, host, paint });
    return paint;
  }
  /** The card page: the panel under the image, edit mode only, for a card with PSD changes or previews. */
  function mountCard(modal, c) {
    if (!app.editor.me) return;
    const getV = () => cardV(c);
    if (!getV().n && !(store[c.id] || []).length) return;
    const wrap = modal.querySelector(".detail .image-wrap");
    if (!wrap) return;
    wrap.insertAdjacentHTML("beforeend", `<div class="pv-host"></div>`);
    wire(wrap, c, getV, "card");
  }
  /** The Edit dialog: the same panel beside the form's "On the card image" fields, the mock-up following the inputs. */
  function mountForm({ form, card: c, read, base }) {
    if (!app.editor.me) return;
    const note = form.querySelector(".egroup-note");
    if (!note) return;
    note.insertAdjacentHTML("afterend", `<div class="pv-host pv-in-form"></div>`);
    const getV = () => formV(c, read(), base);
    const paint = wire(form, c, getV, "form");
    let t = null, last = getV().hash;
    const later = () => { clearTimeout(t); t = setTimeout(() => {      // the mock-up follows the inputs; the panel repaints when the edit changed
      const v = getV(), cv = form.querySelector("[data-pv-mock]");
      if (cv && v.n) drawMock(cv, c, v, form.querySelector(".pv-host")); else if (v.hash !== last) paint();
      last = v.hash;
    }, 120); };
    form.addEventListener("input", later); form.addEventListener("change", later);
    form.addEventListener("click", e => { if (e.target.closest("[data-type], [data-reset], [data-creature], [data-insert]")) later(); });
  }
  const recs = new Map();                             // card id -> details record (or null)
  function drawMock(canvas, c, v, host) {
    const run = (canvas._run = (canvas._run || 0) + 1);
    const go = rec => mockup.draw(canvas, { card: c, src: current(c), rec, edit: v.cur, psd: v.psd, icons: S.icons, getFonts: () => app.getJson("fonts.json"), raw: S.data.raw,
      stale: () => canvas._run !== run || !canvas.isConnected, onFont: () => { if (canvas._run === run) drawMock(canvas, c, v, host); } })
      .then(out => { const el = host.querySelector("[data-pv-mock-note]"); if (out && el) el.textContent = mockNote(out); });
    if (recs.has(c.id) || !c.details) { go(recs.get(c.id) || null); return; }
    let drawn = false;
    const t = setTimeout(() => { drawn = true; go(null); }, 150);
    app.loadDetails(c).then(r => { recs.set(c.id, r); clearTimeout(t); if (!drawn || canvas._run === run) go(r); }, () => { recs.set(c.id, null); });
  }
  const mockNote = out => {
    const lost = Object.entries(out.fonts).filter(([, f]) => !f).map(([n]) => n);
    return [out.skipped.length ? `Not drawn: ${[...new Set(out.skipped)].join(", ")}.` : "", lost.length ? `Stand-in font for ${lost.join(", ")}.` : ""].filter(Boolean).join(" ");
  };
  function wirePair(pair) {
    const prev = pair.querySelector('[data-pv-img="preview"]');
    prev?.addEventListener("error", () => { const f = prev.dataset.fallback; if (f && prev.src !== f) { prev.dataset.fallback = ""; prev.src = f; prev.closest("a").href = f; } });
    const canvas = pair.querySelector("[data-pv-diff]");
    if (!canvas || !pair.classList.contains("diff")) return;
    const cur = pair.querySelector('[data-pv-img="current"]');
    const ready = img => (img.complete && img.naturalWidth ? Promise.resolve() : new Promise((ok, no) => { img.addEventListener("load", ok, { once: true }); img.addEventListener("error", no, { once: true }); }));
    Promise.all([ready(cur), ready(prev)]).then(() => {
      const w = cur.naturalWidth, h = Math.round((cur.naturalWidth * prev.naturalHeight) / prev.naturalWidth) || cur.naturalHeight;
      const grab = img => { const k = document.createElement("canvas"); k.width = w; k.height = h; const x = k.getContext("2d"); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
      const { data, changed } = diffPixels(grab(cur), grab(prev));
      canvas.width = w; canvas.height = h; canvas.getContext("2d").putImageData(new ImageData(data, w, h), 0, 0);
      const el = pair.querySelector("[data-pv-changed]"); if (el) el.textContent = `(${(changed * 100).toFixed(1)}% of the pixels)`;
    }, () => { const el = pair.querySelector("[data-pv-changed]"); if (el) el.textContent = "(couldn't load both images)"; });
  }

  function init() { set(expire(store)); if (app.editor.me) { schedule(1000); } }
  return {
    init, mountTiles, mountCard, mountForm, start, poll: () => poll(),
    /** a card's values changed (null: any): repaint its open panels */
    refresh: id => notify(id),
    onAuth() { if (app.editor.me) schedule(1000); },
    hasNews: id => hasNews(store, id), entries: id => store[id] || [],
  };
}
