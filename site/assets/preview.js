// Card image previews in edit mode: the quick mock-up (mockup.js, drawn in the browser) and the rendered preview, a dry-run
// bake of the card's PSD-kind fields by the card repo's card-preview.yml (AutoCroissant commands/card_preview.py; the
// contract in site/NOTES.md §19 "Card previews"; the UI §22: workflow_dispatch with card, edit and request,
// the result on the orphan branch "previews"). The site starts it with the signed-in editor's token, remembers each
// request in localStorage (the last KEEP per card), checks in the background (pollDelay, up to MAX_WAIT_MS; one tab checks
// for all) while the editor works on other cards, badges a card whose preview is ready and shows it when the card is
// opened again: in the card image's viewer (tabs Original, Mock-up, Rendered; a diff), or why the bake would refuse it.
// Pure helpers above createPreviews.
import { esc } from "./text.js";
import { sameField, value, psdValue } from "./edit.js";
import * as mockup from "./mockup.js";
import { partsLine } from "./parts.js";

/** The Action's side, in one place: change it here if card-preview.yml's inputs or files change. */
export const CONTRACT = {
  workflow: "card-preview.yml", ref: "main", branch: "previews",
  inputs: (card, edit, request) => ({ card: card.key, edit: JSON.stringify(edit), request }),
  result: request => `previews/${request}/result.json`,
  file: (request, name) => `previews/${request}/${name}`,
};
export const KEY = "card-previews";                   // localStorage: {card id: [entry, newest first]}
export const LOCK_KEY = "card-previews-poll";         // localStorage: {tab, until}: the tab that checks for all of them
export const KEEP = 3, MAX_EDIT = 16384;              // MAX_EDIT: card_preview's, UTF-8 bytes of the edit's JSON
// the contract's checks: none in the first 25 s (a run takes 40-65 s), every 5 s until 2 minutes, every 10 s until 3,
// then every 30 s, giving up at 16 (the jobs' timeouts add up to 14); "Check again" waits 10 more
export const FIRST_MS = 25000, POLL_FAST = 5000, FAST_FOR = 2 * 60000, POLL_MID = 10000, MID_FOR = 3 * 60000, POLL_SLOW = 30000;
export const MAX_WAIT_MS = 16 * 60000, MORE_WAIT_MS = 10 * 60000;
// the previews branch keeps a preview at least 6 days (rewritten past 200 or 7 days): older ones are "expired"; a 404
// more than a day after the press means it never comes; entries go after 30 days
export const SHOW_MS = 6 * 864e5, LATE_MS = 864e5, DROP_MS = 30 * 864e5;
export const PSD_FIELDS = ["name", "stars", "types", "hp", "def", "atk", "spd", "ability"];   // printed on the card (edit.js FROM "PSD")
export const ENTRY_FIELDS = [...PSD_FIELDS, "creatures", "parts"];                         // what the edit carries (creatures gates a stat bake; parts: per layer)
export const DONE = ["baked", "redundant", "refused", "error"];                            // result.json states
const REQUEST_RE = /^[A-Za-z0-9-]{8,64}$/;            // card-preview.yml's check
const STATS = ["hp", "def", "atk", "spd"];
const LABEL = { name: "Name", stars: "Stars", types: "Types", hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", ability: "Text", creatures: "Creatures", parts: "Text boxes" };

const text = v => String(v ?? "").replace(/\r/g, "").trim();
/** The edit a preview sends: the PSD-kind fields (and creatures) of the card's Card Edits.json entry as Publish would leave
 *  it (fields: its field names; get(f): the value), in Card Edits.json shapes. All of them, not only the changed ones:
 *  the bake bakes the committed ones too. */
export function entryEdit(fields, get) {
  const out = {};
  for (const f of ENTRY_FIELDS) {
    if (!fields.includes(f)) continue;
    const v = get(f);
    if (f === "creatures" ? !(Array.isArray(v) && v.length > 1) : f === "parts" ? !(v && typeof v === "object" && Object.keys(v).length) : v === undefined) continue;
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
  const files = Object.fromEntries(Object.entries(obj(r.files)).filter(([k, v]) => ["webp", "png", "before"].includes(k) && typeof v === "string" && /^[\w.-]+\.(webp|png)$/i.test(v)));
  const fields = Object.fromEntries(Object.entries(obj(r.fields)).filter(([k, v]) => k in LABEL && typeof v === "string").map(([k, v]) => [k, v.slice(0, 20)]));
  const changes = (Array.isArray(r.changes) ? r.changes : []).filter(x => x && typeof x === "object" && typeof x.field === "string").slice(0, 12)
    .map(x => ({ field: x.field, old: x.old, new: x.new }));
  const parts = Object.fromEntries(Object.entries(obj(r.parts)).filter(([k, v]) => /^(\d+|\+ability)$/.test(k) && typeof v === "string").slice(0, 64).map(([k, v]) => [k, v.slice(0, 20)]));   // v2: per layer
  return { state: r.state, transient: r.transient === true, reason: r.reason ? clip(r.reason) : "", notes, fields, changes, base, parts,
    variant: Number.isInteger(r.variant) ? r.variant : null,
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
/** store without the entry of that request (Discard: thrown away in this browser; the branch's copy expires on its own). */
export function discard(store, request) {
  const out = {};
  for (const [id, list] of Object.entries(store)) { const left = list.filter(e => e.request !== request); if (left.length) out[id] = left; }
  return out;
}
const TRASH = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.6h4V4M4 4l.7 9.4h6.6L12 4M6.6 6.6v4.6M9.4 6.6v4.6"/></svg>`;
/** The entries still waiting for their result. */
export const waiting = store => Object.values(store).flat().filter(e => e.state === "running");
/** The store with old entries settled: a start the page left half done is an error, a result or timeout past SHOW_MS is
 *  "expired" (its image is gone from the branch), anything past DROP_MS goes. A running one stays running: only a check
 *  that finds nothing (missed) times it out, so a result that came while the site was closed is still found. */
export function expire(store, now = Date.now()) {
  let out = store;
  for (const e of Object.values(store).flat()) {
    if (e.state === "starting" && now - e.at > 60000) out = patch(out, e.request, { state: "error", error: "It didn't start: the page closed first.", seen: true });
    else if ((DONE.includes(e.state) || e.state === "timeout") && now - e.at > SHOW_MS) out = patch(out, e.request, { state: "expired", seen: true });
  }
  const kept = Object.entries(out).map(([id, list]) => [id, list.filter(e => now - e.at <= DROP_MS)]).filter(([, list]) => list.length);
  return kept.length === Object.keys(out).length && kept.every(([id, list]) => list.length === out[id].length) ? out : Object.fromEntries(kept);
}
/** What to look for this round: every running entry; on the first round after a load or a sign-in (first) also the
 *  timed-out ones younger than SHOW_MS: their result may have come while the site was closed. */
export const due = (store, now = Date.now(), first = false) => Object.values(store).flat().filter(e => e.state === "running" || (first && e.state === "timeout" && now - e.at < SHOW_MS));
/** The change for an entry whose result.json isn't there (404): past a day it never comes ("expired"); a running one past
 *  its wait times out; else none (null). */
export function missed(e, now = Date.now()) {
  if (now - e.at > LATE_MS) return { state: "expired", seen: true };
  if (e.state === "running" && now - e.at > (e.wait || MAX_WAIT_MS)) return { state: "timeout" };
  return null;
}
/** ms to the next check (null: nothing running): when the oldest reaches FIRST_MS, then POLL_FAST while one started
 *  under FAST_FOR ago, POLL_MID under MID_FOR, else POLL_SLOW. */
export const pollDelay = (store, now = Date.now()) => {
  const ages = waiting(store).map(e => now - e.at);
  if (!ages.length) return null;
  if (ages.every(a => a < FIRST_MS)) return FIRST_MS - Math.max(...ages);
  return ages.some(a => a < FAST_FOR) ? POLL_FAST : ages.some(a => a < MID_FOR) ? POLL_MID : POLL_SLOW;
};
/** One tab checks for all (the others see the results through the storage event): this tab (id `tab`) may check when it
 *  holds the lock (stored text) or the lock lapsed. -> the lock to store, or null (another tab has it). */
export function takeLock(lockText, tab, now = Date.now(), ttl = 2 * POLL_SLOW + 15000) {
  let l; try { l = JSON.parse(lockText); } catch { l = null; }
  if (l && typeof l === "object" && l.tab !== tab && Number(l.until) > now) return null;
  return { tab, until: now + ttl };
}
/** The entries of `after` that have a result now and didn't in `before`: what to announce. */
export const finished = (before, after) => { const was = new Map(Object.values(before).flat().map(e => [e.request, e.state]));
  return Object.values(after).flat().filter(e => DONE.includes(e.state) && was.has(e.request) && !DONE.includes(was.get(e.request)) && was.get(e.request) !== "expired"); };
/** One toast for the results of a round: "Preview ready: Abbi", "Previews finished: Abbi, Acro and Poison". */
export function finishedToast(list) {
  if (!list.length) return "";
  const names = [...new Set(list.map(e => e.name || e.card))], ready = list.every(e => e.state === "baked");
  const join = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `${list.length > 1 ? (ready ? "Previews ready" : "Previews finished") : ready ? "Preview ready" : "Preview finished"}: ${join}`;
}
/** The edit's size as card_preview counts it: UTF-8 bytes of its JSON. */
export const editBytes = edit => new TextEncoder().encode(JSON.stringify(edit)).length;
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
/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
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
  error: "The preview failed", timeout: "No result yet", starting: "Starting", expired: "Preview expired",
};
/** The rendered preview of entry e (or none) for the image viewer: {stage, caption, dim}. stage: the preview image over the
 *  card's image (a hidden current image and the diff canvas with it), or the state's words over the dimmed original (dim);
 *  caption: the status lines, outcomes, notes and buttons. v: {card, n (fields the image would change by), hash, now,
 *  scopes, images (preview URLs: the 720 px WebP, the full PNG), current (what Diff compares with: the result's before.webp,
 *  else the site's image), mixed (current is the site's AVIF: another codec), diff}. */
export function renderedParts(e, v) {
  const button = (label, cls = "") => `<button type="button" class="${cls}" data-pv="start"${v.n ? "" : " disabled"}>${label}</button>`;
  const scopeNote = scopeOk(v.scopes) === false ? `<p class="muted pv-note">Your token has only the public_repo scope; starting a preview needs the repo scope (or a fine-grained token with Actions: Read and write).</p>` : "";
  const words = (text, spin = false) => ({ stage: `<span class="iv-label">${spin ? `<span class="pv-spin" aria-hidden="true"></span> ` : ""}${esc(text)}</span>`, dim: true });
  if (!e) {
    return { ...words("Not previewed yet"), caption: `<p class="muted">${v.n ? "A dry run of the bake, in a few minutes: open other cards meanwhile. Anyone can see a previewed edit." : "No changes on the card image to preview."}</p>
      ${scopeNote}<div class="actions">${button("Preview image", "primary")}</div>` };
  }
  const r = e.result || {}, stale = DONE.includes(e.state) ? staleWhy(e, v.card, v.hash) : [];
  const staleText = stale.length ? `<p class="pv-stale" role="note">Out of date: ${stale.map(w => (w === "edit" ? "the edit changed since" : "the card changed since")).join(" and ")}. ${button("Preview again", "ghost")}</p>` : "";
  const trash = e.state === "starting" || e.state === "running" ? "" : ` <button type="button" class="ghost icon pv-discard" data-pv="discard" title="Discard this preview" aria-label="Discard this preview">${TRASH}</button>`;
  const head = `<p class="pv-state" data-state="${esc(e.state)}"><b>${esc(STATE_TEXT[e.state] || e.state)}</b> · ${esc(fieldsLine(e.edit || {}))} · <span class="muted">${esc(ago(v.now - e.at))}</span>${trash}</p>`;
  const outcomes = (r.fields && Object.keys(r.fields).length ? `<p class="pv-fields">${esc(outcomesLine(r.fields))}</p>` : "")
    + (r.parts && Object.keys(r.parts).length ? `<p class="pv-fields">${esc(partsLine(r.parts))}</p>` : "");
  const notes = r.notes?.length ? `<ul class="pv-notes">${r.notes.map(x => `<li>${esc(plainNote(x))}</li>`).join("")}</ul>` : "";
  const run = r.run || e.run?.url, runLink = run ? ` <a href="${esc(run)}" target="_blank" rel="noopener">The run on GitHub</a>.` : "";
  const again = stale.length ? "" : button("Preview again", "ghost");
  const state = words(STATE_TEXT[e.state] || e.state);
  if (e.state === "starting" || e.state === "running") {
    return { ...words(STATE_TEXT[e.state], true), caption: `${head}<p class="muted">The Action is drawing it, usually in about a minute; checked in the background for up to ${Math.round((e.wait || MAX_WAIT_MS) / 60000)} min.${runLink}</p>` };
  }
  if (e.state === "expired") return { ...state, caption: `${head}<p>Its image is gone: previews are kept about a week.</p>${outcomes}<div class="actions">${button("Preview again", "ghost")}</div>` };
  const shot = alt => {                               // the preview in the stage; Diff swaps in the red differences
    const [src, full] = v.images, diff = v.diff && !!v.current;
    return { dim: false,
      stage: `<a href="${esc(full || src)}" target="_blank" rel="noopener" title="Full size"${diff ? " hidden" : ""}><img src="${esc(src)}" alt="${esc(v.card.name)}, ${esc(alt)}" crossorigin="anonymous" data-pv-img="preview"></a>
        ${v.current ? `<img src="${esc(v.current)}" alt="" crossorigin="anonymous" data-pv-img="current" hidden><canvas data-pv-diff role="img" aria-label="Differences between the current image and the preview, in red"${diff ? "" : " hidden"}></canvas>` : ""}`,
      tools: `<div class="actions">${v.current ? `<button type="button" class="ghost" data-pv="diff" aria-pressed="${diff}">Diff</button>` : ""}${full ? `<a class="fact" href="${esc(full)}" target="_blank" rel="noopener">Full size</a>` : ""}${again}</div>${diff ? `<p class="muted pv-note">Differences in red <span data-pv-changed></span>${v.mixed ? ". An older preview: compared with the site's image, another format, so faint red outlines show where nothing changed" : ""}</p>` : ""}` };
  };
  if (e.state === "baked" && v.images.length) { const s = shot("rendered preview"); return { stage: s.stage, dim: false, caption: `${head}${staleText}${s.tools}${outcomes}${notes}` }; }
  if (e.state === "baked") return { ...words("No image"), caption: `${head}${staleText}<p>The bake drew it, but no image came with the result.${runLink}</p>${outcomes}${notes}${again ? `<div class="actions">${again}</div>` : ""}` };
  if (e.state === "redundant") return { ...state, caption: `${head}${staleText}<p>Already on the card: a bake would change nothing.</p>${outcomes}${notes}` };
  if (e.state === "refused") {
    const reason = `${head}${staleText}<p>${esc(plainReason(r.reason) || "The bake refused this edit.")}</p>`;
    if (r.image === "refused" && v.images.length) { const s = shot("the bake's render before it refused"); return { stage: s.stage, dim: false, caption: `${reason}<p class="muted pv-note">What the bake drew before refusing it.</p>${s.tools}${outcomes}${notes}` }; }
    return { ...state, caption: `${reason}<div class="actions">${again}</div>${outcomes}${notes}` };
  }
  if (e.state === "timeout") return { ...state, caption: `${head}<p>No result after ${Math.round((e.wait || MAX_WAIT_MS) / 60000)} minutes.${runLink} The run may still finish.</p><div class="actions"><button type="button" class="ghost" data-pv="recheck">Check again</button>${button("Preview again", "ghost")}</div>` };
  const input = /^input:/.test(r.reason || "");
  const why = input ? `The bake couldn't read what the website sent (a website bug): ${r.reason}` : r.reason || e.error || "Something went wrong.";
  const errStale = staleWhy(e, v.card, v.hash).includes("edit") ? `<p class="pv-stale" role="note">Out of date: the edit changed since. ${button("Preview again", "ghost")}</p>` : "";   // "Try again" would send the edit as it is now
  return { ...state, caption: `${head}<p class="err">${esc(why)}</p>${r.transient ? `<p class="muted">Usually passing: try again.</p>` : ""}${notes}${runLink ? `<p>${runLink}</p>` : ""}${e.error ? scopeNote : ""}${errStale || `<div class="actions">${button("Try again", "ghost")}</div>`}` };
}
/** renderedParts as one piece of markup. */
export const TABS = [["original", "Original"], ["mockup", "Mock-up"], ["rendered", "Rendered"]];
/** The viewer's tabs: a tablist, the mode's tab selected (roving tabindex), "New" on Rendered while a result waits unseen. */
export const tabsHtml = (mode, { news = false } = {}) => `<div class="iv-tabs" role="tablist" aria-label="Card image">${TABS.map(([m, label]) =>
  `<button type="button" role="tab" data-iv-tab="${m}" aria-selected="${m === mode}" tabindex="${m === mode ? 0 : -1}">${label}${m === "rendered" && news ? ` <span class="pv-badge inline">New</span>` : ""}</button>`).join("")}</div>`;
/** The tab a viewer opens on: the card page Rendered while the newest preview's result is unseen, else Original; the Edit
 *  dialog Mock-up while the form changes the image (n fields), else Original. */
export const defaultMode = ({ where, n, entry }) => (where === "card" ? (entry && DONE.includes(entry.state) && !entry.seen ? "rendered" : "original") : n ? "mockup" : "original");
// the bake's refusals (AutoCroissant psd_edit plan_stars / plan_types) in plain words, first match; else the text without
// its field, boxes and ledger codes
const LEDGER = /\s*\([^)]*\bledger [A-Z]\d+\)/g;
const PLAIN_WHY = [
  [/folder sets them/, "the card's folder sets them"],
  [/parser reads no stars/, "this card has none"],
  [/at least one/, "a card shows at least one"],
  [/parser counts \d+, the Stars group draws/, "some are in the header text"],
  [/would make \d+|no folder for|new layout would count|laid out as no row/, "there's no layout for that many"],
  [/runs off the canvas|would touch/, "there's no room for them"],
  [/printed as icon tokens/, "they're typed in the text: edit them in Photoshop"],
  [/not an icon to take off/, "one can't be taken off"],
  [/no type icon on the card to line/, "there's no icon to line a new one up with"],
  [/no Types\/ icon|in Types\/|draws nothing/, "an icon has no picture yet"],
  [/is no type icon/, "one isn't a type icon"],
  [/Stars groups? draw|group named "Stars"|no star shows|in one group|are elsewhere|clipped to|cannot move|is text|vector shape|smart filters/,
    "the card's layers aren't laid out the usual way"],
];
/** A refusal's reason for the caption: "the '5 Stars' folder sets them (moving the card is ledger S9)" -> "the card's
 *  folder sets them". */
export function plainWhy(why) {
  const s = String(why ?? "");
  return PLAIN_WHY.find(([re]) => re.test(s))?.[1]
    ?? (s.replace(LEDGER, "").replace(/^(?:stars|types): /, "").replace(/ at \(\d+(?:, \d+)*\)/g, "").trim() || "no reason given");
}
/** A refused result's reason: "unsupported-card: stars: <why>" (parts joined by "; ") -> "The bake would refuse the
 *  stars: <plainWhy>."; any other reason without its ledger codes. */
export function plainReason(reason) {
  const s = String(reason ?? ""), parts = s.split("; ").map(x => /^[a-z-]+: (stars|types): (.*)$/s.exec(x));
  return s && parts.every(Boolean) ? parts.map(([, f, why]) => `The bake would refuse the ${f}: ${plainWhy(why)}.`).join(" ") : s.replace(LEDGER, "");
}
/** A result note: "stars not baked: <code>: <why>" -> "The stars weren't baked: <plainWhy>."; others without ledger codes. */
export function plainNote(note) {
  const s = String(note ?? ""), m = /^(stars|types) not baked: [a-z-]+: (.*)$/s.exec(s);
  return m ? `The ${m[1]} weren't baked: ${plainWhy(m[2])}.` : s.replace(LEDGER, "");
}
/** The mock-up's caption note from draw()'s result: what went in a box, ran over, wasn't drawn or the bake would refuse. */
export function mockNote(out) {
  const lost = Object.entries(out.fonts || {}).filter(([, f]) => !f).map(([n]) => n), cap = s => s[0].toUpperCase() + s.slice(1);
  const boxed = out.boxed || [], many = boxed.length > 1 || /s$/.test(boxed[0] || "");
  return [boxed.length ? `${cap(boxed.join(" and "))} in a box: ${many ? "their places" : "its place"} on the image ${many ? "weren't" : "wasn't"} found.` : "",
    out.over?.length ? `The ${out.over.join(" and the ")} runs past ${out.over.length > 1 ? "their" : "its"} place on the card.` : "",
    ...(out.refused || []).map(([label, why]) => `The bake would refuse the ${label}: ${plainWhy(why)}.`),
    out.skipped?.length ? `Not drawn: ${[...new Set(out.skipped)].join(", ")}.` : "", lost.length ? `Stand-in font for ${lost.join(", ")}.` : "",
    out.standIn?.length ? `Stand-in font for the ${out.standIn.join(" and the ")} (the card's isn't known).` : ""].filter(Boolean).join(" ");
}
/** The older previews of a card, as buttons to show one: entries after the first. */
export const olderHtml = (list, now, shown) => (list.length > 1 ? `<div class="pv-older" role="group" aria-label="Earlier previews"><span class="muted">Earlier:</span> ${list.map((e, i) => `<button type="button" class="chip" data-pv-show="${i}" aria-pressed="${i === shown}">${i ? esc(ago(now - e.at)) : "newest"} · ${esc(STATE_TEXT[e.state] || e.state)}</button>`).join(" ")}</div>` : "");

export function createPreviews(app) {
  // app: {S, editor (me, github(path, opts), scopes, psdOf(id)), toast, loadDetails(c), getJson(name), signIn(note),
  // badges() (re-mark the grid's tiles)}
  const { S } = app;
  let store = readStore(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full: this page only */ } };
  const set = s => { store = s; save(); };
  const live = new Set();                             // the open viewers: {id, host, paint}
  const prune = () => { for (const p of [...live]) if (!p.host.isConnected) live.delete(p); };
  const notify = id => { app.badges(); prune(); for (const p of live) if (id == null || p.id === id) p.paint(); };
  const visible = () => document.visibilityState === "visible";
  let heard = [], heardT = null;                      // results of one round arrive as several storage events: one toast
  const announce = list => { if (!list.length) return; heard.push(...list); clearTimeout(heardT);
    heardT = setTimeout(() => { const m = finishedToast(heard); heard = []; if (m && visible()) app.toast(m); }, 400); };
  window.addEventListener("storage", e => {         // another tab: its starts, and the results the checking tab found
    if (e.key !== KEY) return;
    const before = store; store = readStore(e.newValue);
    announce(finished(before, store)); notify(null); schedule();
  });
  const TAB = Math.random().toString(36).slice(2);     // this tab, for the check's lock
  const lockMine = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY))?.tab === TAB; } catch { return false; } };
  window.addEventListener("pagehide", () => { if (lockMine()) localStorage.removeItem(LOCK_KEY); });   // the next tab takes over at once
  const repo = () => S.data.repo;
  const rawUrl = (ref, path) => `https://raw.githubusercontent.com/${repo()}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const imagesOf = e => [e.result?.files?.webp, e.result?.files?.png].filter(Boolean).map(f => rawUrl(CONTRACT.branch, CONTRACT.file(e.request, f)));   // the 720 px WebP, the full PNG
  const current = c => app.img(c, 720);
  // the Diff's other side: the result's before.webp (the card's PNG made as preview.webp, so unchanged pixels match);
  // a result from before it was published has none: the site's AVIF thumb, whose codec noise shows too
  const beforeOf = e => (e?.result?.files?.before ? rawUrl(CONTRACT.branch, CONTRACT.file(e.request, e.result.files.before)) : "");

  // ---- the values: the card's (published + staged) or the open form's, against the PSD's
  const psdOf = c => app.editor.psdOf(c.id) || {};
  // v: {edit (sent), hash, n (fields the image would change by), cur (every PSD field's value), psd}
  const values = (cur, psd, edit) => ({ edit, hash: hashOf(edit), n: Object.keys(changedOf(cur, psd)).length || (cur.parts ? 1 : 0), cur, psd });   // part edits whose join reads the same still change the image
  // the parts editor: the PSD's entry (variant 1's) holds the part edits, stars, types and stats of every picture
  const withParts = (c, cur, edit, op = null) => {
    for (const f of app.editor.siteFields?.(c.id, op || undefined) || []) cur[f] = psdOf(c)[f];   // website only: the image keeps it
    const parts = app.editor.entryParts?.(c.id, op), first = c.variantOf && S.byId.get(c.variantOf);
    if (first) { const own = entryEdit(app.editor.entryFields(first.id), f => value(first, f, S.byId)); for (const f of ENTRY_FIELDS) if (f !== "name" && f !== "ability" && f in own && !(f in edit)) edit[f] = own[f]; }
    if (parts) { edit.parts = parts; cur.parts = parts; }
    return values(cur, psdOf(c), edit);
  };
  const cardV = c => { const cur = Object.fromEntries(PSD_FIELDS.map(f => [f, value(c, f, S.byId)]));   // published + staged
    return withParts(c, cur, entryEdit(app.editor.entryFields(c.id), f => value(c, f, S.byId))); };
  const formV = (c, op, base) => {                    // the open form's, relative to the published card (base)
    const get = f => (f in op.set ? op.set[f] : (op.unset || []).includes(f) ? psdValue(base, f, S.byId) : value(base, f, S.byId));
    return withParts(c, Object.fromEntries(PSD_FIELDS.map(f => [f, get(f)])), entryEdit(app.editor.entryFields(c.id, op), get), op);
  };

  // ---- starting one
  async function start(c, edit) {
    const ed = app.editor;
    if (!ed.me) { app.signIn(`Sign in to preview ${c.name}'s image.`); return; }
    if (!Object.keys(edit).length) { app.toast("No changes on the card image to preview"); return; }
    if (editBytes(edit) > MAX_EDIT) { app.toast("This edit is over 16 KB: the preview takes less"); return; }
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
    notify(c.id); schedule();
  }

  // ---- the background check: while any is running (pollDelay), from any page, signed in, by one tab (takeLock)
  let timer = null, busy = false, first = true;       // first: the round after a load or a sign-in also looks at timed-out ones
  function schedule(ms = null) {
    const wait = ms ?? pollDelay(store);
    if (timer || !app.editor.me || wait == null) return;
    timer = setTimeout(() => { timer = null; poll().finally(() => schedule()); }, wait);
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
    if (!only) {                                      // one tab checks for all
      const lock = takeLock(localStorage.getItem(LOCK_KEY), TAB);
      if (!lock) return;
      try { localStorage.setItem(LOCK_KEY, JSON.stringify(lock)); } catch { /* storage off: check anyway */ }
    }
    busy = true;
    const before = store, look = first;
    try {
      set(expire(store));
      for (const e of only ? [only] : due(store, Date.now(), look)) {
        if (!only && e.state === "running" && Date.now() - e.at < FIRST_MS) continue;   // too soon to be done
        let raw = null;
        try { raw = await fetchResult(e); } catch { continue; }                 // GitHub unreachable: next time
        if (raw != null) {
          const result = readResult(raw);
          set(patch(store, e.request, { state: result.state, result, done: Date.now() }));
          notify(e.card);
          continue;
        }
        const gone = missed(e);                                              // not there: timed out, or never coming
        if (gone) { set(patch(store, e.request, gone)); notify(e.card); continue; }
        if (e.state !== "running" || Date.now() - (e.runAt || e.at) < 60000) continue;   // the run: looked up once a minute
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
      if (!only) first = false;
    } finally { busy = false; announce(finished(before, store)); }
  }

  // ---- marks: the grid's badges, the image viewer on the card page and in the Edit dialog's Preview pane
  function mountTiles(root) {
    for (const t of root.querySelectorAll(".tile[data-open]")) {
      const id = t.dataset.open, on = hasNews(store, id), b = t.querySelector(".pv-badge");
      if (on && !b) t.insertAdjacentHTML("beforeend", `<span class="pv-badge" data-tip="${esc(badgeTip(store[id][0].state))}">Preview</span>`);
      else if (on) b.dataset.tip = badgeTip(store[id][0].state);   // a reused tile: its tip as of now
      else if (b) b.remove();
    }
  }
  const views = new Map();                            // card id -> {mode, diff, shown}: the viewer's choices while the page lives
  /** The image viewer in iv (.iv holding .iv-stage > .iv-orig, the original, never re-rendered): tabs, the alternative
   *  image over the original (the mock-up canvas or the rendered preview) and a caption. Returns its paint(). */
  function viewer(iv, c, getV, where) {
    const stage = iv.querySelector(".iv-stage");
    iv.insertAdjacentHTML("afterbegin", tabsHtml("original"));
    stage.insertAdjacentHTML("beforeend", `<div class="iv-alt" hidden></div>`);
    iv.insertAdjacentHTML("beforeend", `<div class="iv-caption" aria-live="polite"></div>`);
    const tabs = iv.querySelector(".iv-tabs"), alt = stage.querySelector(".iv-alt"), cap = iv.querySelector(".iv-caption");
    const pick = mode => views.set(c.id, { ...views.get(c.id), mode });
    const paint = () => {
      const v = getV(), list = store[c.id] || [], st = views.get(c.id) || {};
      const shown = Math.min(st.shown || 0, Math.max(0, list.length - 1)), e = list[shown];
      const mode = st.mode || defaultMode({ where, n: v.n, entry: list[0] });
      for (const b of tabs.children) { const on = b.dataset.ivTab === mode; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
      const pill = tabs.querySelector(".pv-badge"), news = hasNews(store, c.id);
      if (news && !pill) tabs.lastElementChild.insertAdjacentHTML("beforeend", ` <span class="pv-badge inline">New</span>`); else if (!news && pill) pill.remove();
      let show = "orig";
      if (mode === "mockup" && v.n && c.img) {
        show = "alt";
        alt.innerHTML = `<canvas data-pv-mock role="img" aria-label="Mock-up of ${esc(c.name)} with your edit"></canvas><span class="pv-ribbon" aria-hidden="true">Mock-up</span>`;
        cap.innerHTML = `${esc(mockup.LABEL)}. <span class="muted" data-pv-mock-note></span>${list[0] && (list[0].state === "starting" || list[0].state === "running") ? "" : `<div class="actions"><button type="button" data-pv="start">Preview image</button></div>`}`;
        drawMock(alt.firstElementChild, c, v, iv);
      } else if (mode === "mockup") {
        alt.innerHTML = ""; cap.innerHTML = `<p class="muted">${c.img ? "No changes on the card image yet." : "This card has no image to draw on."}</p>`;
      } else if (mode === "rendered") {
        const parts = renderedParts(e, { ...v, card: c, now: Date.now(), images: e ? imagesOf(e) : [], current: beforeOf(e) || current(c), mixed: !!e && !beforeOf(e), diff: st.diff, scopes: app.editor.scopes });
        show = parts.dim ? "dim" : "alt";
        alt.innerHTML = parts.stage; cap.innerHTML = parts.caption + olderHtml(list, Date.now(), shown);
        if (!parts.dim) wireShot(alt, cap, e);
        const top = list[0];
        if (where === "card" && top && DONE.includes(top.state) && !top.seen) { pick("rendered"); set(patch(store, top.request, { seen: true })); app.badges(); tabs.querySelector(".pv-badge")?.remove(); }
      } else { alt.innerHTML = ""; cap.innerHTML = ""; }
      alt.hidden = show === "orig";
      iv.dataset.show = show;
    };
    iv.onclick = ev => {
      const t = sel => ev.target.closest(sel);
      if (t("[data-iv-tab]")) { pick(t("[data-iv-tab]").dataset.ivTab); paint(); return; }
      if (t("[data-pv-show]")) { views.set(c.id, { ...views.get(c.id), shown: +t("[data-pv-show]").dataset.pvShow }); paint(); return; }
      const act = t("[data-pv]")?.dataset.pv;
      if (act === "start") { views.set(c.id, { ...views.get(c.id), mode: "rendered", shown: 0 }); start(c, getV().edit); }
      else if (act === "diff") { const st = views.get(c.id) || {}; views.set(c.id, { ...st, diff: !st.diff }); paint(); }
      else if (act === "discard") {                   // the preview shown, thrown away here; the next one (or none) shows
        const st = views.get(c.id) || {}, list = store[c.id] || [], e = list[Math.min(st.shown || 0, Math.max(0, list.length - 1))];
        if (e) { set(discard(store, e.request)); views.set(c.id, { ...st, shown: 0, diff: false }); notify(c.id); }
      }
      else if (act === "recheck") { const e = (store[c.id] || [])[0]; if (e) { set(patch(store, e.request, { state: "running", wait: Date.now() - e.at + MORE_WAIT_MS })); notify(c.id); poll(store[c.id][0]).then(() => notify(c.id)); schedule(); } }
    };
    tabs.onkeydown = ev => {                          // arrows, Home, End move between the tabs (not to the next card)
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      ev.preventDefault(); ev.stopPropagation();
      const all = [...tabs.children], i = Math.max(0, all.indexOf(ev.target.closest("[data-iv-tab]")));
      const to = all[ev.key === "Home" ? 0 : ev.key === "End" ? all.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      pick(to.dataset.ivTab); paint(); to.focus();
    };
    paint();
    prune(); live.add({ id: c.id, host: iv, paint });
    return paint;
  }
  /** The card page: the viewer on the card image, edit mode only, for a card with PSD changes or previews. */
  function mountCard(modal, c, loaded = false) {
    if (!app.editor.me) return;
    if (!loaded && app.editor.partsLoaded?.(c) === false) {     // the part edits come from the details records: those first
      const iv = modal.querySelector(".detail .image-wrap .iv");
      if (iv) app.editor.loadParts(c).then(() => { if (iv.isConnected) mountCard(modal, c, true); });
      return;
    }
    const getV = () => cardV(c);
    if (!getV().n && !(store[c.id] || []).some(e => e.state !== "expired")) return;   // nothing to show but a preview that's gone
    const iv = modal.querySelector(".detail .image-wrap .iv");
    if (iv) viewer(iv, c, getV, "card");
  }
  /** The Edit dialog: the viewer at the top of the live Preview pane, the mock-up following the inputs. */
  function mountForm({ form, card: c, read, base }) {
    if (!app.editor.me) return;
    const iv = form.closest(".dialog")?.querySelector(".lp-pane .iv");
    if (!iv) return;
    const getV = () => formV(c, read(), base);
    const paint = viewer(iv, c, getV, "form");
    let t = null, last = getV().hash;
    const later = () => { clearTimeout(t); t = setTimeout(() => {      // the mock-up follows the inputs; the rest repaints when the edit changed
      const v = getV(), cv = iv.querySelector("[data-pv-mock]");
      if (cv && v.n) drawMock(cv, c, v, iv); else if (v.hash !== last) paint();
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
  function wireShot(alt, cap, e) {                    // a preview gone from the branch, and the diff while it shows
    const prev = alt.querySelector('[data-pv-img="preview"]');
    prev?.addEventListener("error", () => {
      if (e && Date.now() - e.at > LATE_MS) { set(patch(store, e.request, { state: "expired", seen: true })); notify(e.card); }   // the branch dropped it (the contract: a 404 after a day)
    });
    const canvas = alt.querySelector("[data-pv-diff]");
    if (!canvas || canvas.hidden) return;
    const cur = alt.querySelector('[data-pv-img="current"]');
    const ready = img => (img.complete && img.naturalWidth ? Promise.resolve() : new Promise((ok, no) => { img.addEventListener("load", ok, { once: true }); img.addEventListener("error", no, { once: true }); }));
    Promise.all([ready(cur), ready(prev)]).then(() => {
      const w = cur.naturalWidth, h = Math.round((cur.naturalWidth * prev.naturalHeight) / prev.naturalWidth) || cur.naturalHeight;
      const grab = img => { const k = document.createElement("canvas"); k.width = w; k.height = h; const x = k.getContext("2d"); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
      const { data, changed } = diffPixels(grab(cur), grab(prev));
      canvas.width = w; canvas.height = h; canvas.getContext("2d").putImageData(new ImageData(data, w, h), 0, 0);
      const el = cap.querySelector("[data-pv-changed]"); if (el) el.textContent = `(${(changed * 100).toFixed(1)}% of the pixels)`;
    }, () => { const el = cap.querySelector("[data-pv-changed]"); if (el) el.textContent = "(couldn't load both images)"; });
  }

  // the first check soon after a load or a sign-in, for a running one or one that timed out while the site was closed
  const soon = () => { first = true; if (due(store, Date.now(), true).length) schedule(1000); };
  function init() { set(expire(store)); soon(); }
  return {
    init, mountTiles, mountCard, mountForm, start, poll: () => poll(),
    /** a card's values changed (null: any): repaint its open viewers */
    refresh: id => notify(id),
    onAuth() { if (app.editor.me) soon(); },
    hasNews: id => hasNews(store, id), entries: id => store[id] || [],
  };
}
