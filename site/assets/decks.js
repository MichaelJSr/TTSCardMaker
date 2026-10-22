// Published decks: site/decks/<owner>/<slug>.json, one file per deck a signed-in person publishes from the deck builder
// (edit.js stages it with the batch; build_site.py reads the folder into data/decks.json). A public file holds the hand in
// clear; a private one is AES-GCM ciphertext made here, opened on the deck page with its passphrase. DOM-free at import:
// app.js renders the HTML below and wires it. Every string is user-written and goes through esc.
import { esc } from "./text.js";
import { LOGIN_RE } from "./profile.js";
import { HAND } from "./deck.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const LIMITS = { name: 80, description: 500, cards: 40, slug: 60, passphrase: 8, file: 16 * 1024 };
export const KDF = { name: "PBKDF2", hash: "SHA-256", iter: 300000 };
const MAX_ITER = 5_000_000;                                 // a hostile file can't make the page grind for minutes
export const SORTS = [["newest", "Newest"], ["name", "Name"], ["owner", "Owner"]];
const line = s => String(s ?? "").split(/\s+/).filter(Boolean).join(" ");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = v => (typeof v === "string" ? v : "");
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
const hand = d => ({ ...obj(d), cards: Array.isArray(obj(d).cards) ? obj(d).cards.map(String) : [], field: obj(d).field ? String(obj(d).field) : null });   // what deck.js validate expects

// ---- names and keys --------------------------------------------------------------------------------
/** The file name for a deck name: lowercase, anything but a-z0-9 to "-", collapsed and trimmed; "hand" when nothing is left. */
export function slugOf(name) {
  let s = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  s = s.slice(0, LIMITS.slug).replace(/-+$/, "");
  return s || "hand";
}
/** slug, or slug-2, slug-3… when `taken` (an iterable of slugs) already has it. */
export function uniqueSlug(slug, taken) {
  const have = new Set([...taken].map(s => String(s).toLowerCase()));
  if (!have.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const tail = `-${i}`, s = `${slug.slice(0, LIMITS.slug - tail.length).replace(/-+$/, "")}${tail}`;
    if (!have.has(s)) return s;
  }
}
export const keyOf = (owner, slug) => `${String(owner ?? "").toLowerCase()}/${slug}`;
export const aadOf = (owner, slug) => `deck:${keyOf(owner, slug)}`;         // binds the ciphertext to its path
export const deckHash = (owner, slug) => `#/decks/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;

// ---- validation and the file ---------------------------------------------------------------------
/** The hand as the file holds it, checked with the build's limits: {deck: {name, description, cards, field}, errors[],
 *  dropped[]}. ctx.byId (Map id -> card) drops unknown ids like the build does. */
export function validateDeck(raw, { byId = null } = {}) {
  raw = obj(raw);
  const errors = [], dropped = [];
  const name = line(raw.name);
  if (!name) errors.push("Name: needed");
  else if (name.length > LIMITS.name) errors.push(`Name: at most ${LIMITS.name} characters`);
  const description = String(raw.description ?? "").replace(/\r\n?/g, "\n").trim();
  if (description.length > LIMITS.description) errors.push(`Description: at most ${LIMITS.description} characters`);
  let cards = [...new Set((Array.isArray(raw.cards) ? raw.cards : []).map(String).filter(Boolean))];
  let field = raw.field ? String(raw.field) : null;
  if (byId) {
    cards = cards.filter(id => byId.has(id) || (dropped.push(id), false));
    if (field && !byId.has(field)) { dropped.push(field); field = null; }
  }
  if (field) cards = cards.filter(id => id !== field);   // listed once, as the field card
  if (cards.length > LIMITS.cards) errors.push(`At most ${LIMITS.cards} cards`);
  return { deck: { name, description, cards, field }, errors, dropped };
}
/** The public file object, exactly what site/decks/<owner>/<slug>.json holds. */
export const fileOf = ({ owner, name, description = "", cards = [], field = null, updated }) =>
  ({ v: 1, owner, name, description, cards: [...cards], field: field || null, ...(updated ? { updated } : {}) });
/** The file's text: keys sorted, 2-space indent, trailing newline (as the profiles). */
export const fileText = file => `${JSON.stringify(sortKeys(file), null, 2)}\n`;
export const isPrivate = file => !!file && file.private === true;
export const countOf = d => (Array.isArray(d?.cards) ? d.cards.length : 0) + (d?.field ? 1 : 0);
/** Whether a public entry's hand holds the card (its field card too). */
export const usesCard = (d, id) => { d = obj(d); return !!id && !d.private && ((Array.isArray(d.cards) && d.cards.includes(id)) || d.field === id); };
/** A decrypted payload (or any object) as the page expects it. */
export const payloadOf = o => { o = obj(o); return { name: line(o.name) || "Hand", description: str(o.description), cards: Array.isArray(o.cards) ? o.cards.map(String) : [], field: o.field ? String(o.field) : null }; };

// ---- base64 and the cipher -------------------------------------------------------------------------
export const b64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = text => Uint8Array.from(atob(String(text ?? "")), ch => ch.charCodeAt(0));
const utf8 = s => new TextEncoder().encode(s);
async function deriveKey(subtle, passphrase, salt, iter, uses) {
  const raw = await subtle.importKey("raw", utf8(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: KDF.hash, salt, iterations: iter }, raw, { name: "AES-GCM", length: 256 }, false, uses);
}
/** The private file object for a payload {name, description, cards, field}: PBKDF2(passphrase) -> AES-GCM-256, the path as
 *  additional data so the file can't be moved under another owner or slug. */
export async function encrypt(subtle, passphrase, owner, slug, payload, { iter = KDF.iter, random = bytes => globalThis.crypto.getRandomValues(bytes) } = {}) {
  const salt = random(new Uint8Array(16)), iv = random(new Uint8Array(12));
  const key = await deriveKey(subtle, passphrase, salt, iter, ["encrypt"]);
  const data = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aadOf(owner, slug)) }, key, utf8(JSON.stringify(payloadOf(payload))));
  return { v: 1, owner, private: true, kdf: { name: KDF.name, hash: KDF.hash, iter, salt: b64(salt) }, iv: b64(iv), data: b64(new Uint8Array(data)) };
}
/** The payload of a private file, or throws: "Wrong passphrase" (also for a moved or tampered file), or what's wrong with the file. */
export async function decrypt(subtle, passphrase, owner, slug, file) {
  file = obj(file);
  const kdf = obj(file.kdf);
  if (kdf.name !== KDF.name || kdf.hash !== KDF.hash || !Number.isInteger(kdf.iter) || kdf.iter < 1 || kdf.iter > MAX_ITER) throw new Error("This deck file uses an unknown encryption");
  let salt, iv, data;
  try { salt = unb64(kdf.salt); iv = unb64(file.iv); data = unb64(file.data); } catch { throw new Error("This deck file is damaged"); }
  if (salt.length < 8 || iv.length !== 12 || !data.length) throw new Error("This deck file is damaged");
  const key = await deriveKey(subtle, passphrase, salt, kdf.iter, ["decrypt"]);
  let plain;
  try { plain = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8(aadOf(owner, slug)) }, key, data); }
  catch { throw new Error("Wrong passphrase"); }
  try { return payloadOf(JSON.parse(new TextDecoder().decode(plain))); } catch { throw new Error("This deck file is damaged"); }
}

// ---- data/decks.json and the stage, as the pages see them ------------------------------------------------
// an entry: {owner, slug, updated, state ("" | "staged" | "sent"), private: false, name, description, cards, field, n, dropped}
// or {owner, slug, updated, state, private: true, kdf, iv, data}; a decrypted private one is the entry plus the payload.
export function publicEntry(d, byId = null, state = "") {
  d = obj(d);
  const owner = str(d.owner), slug = str(d.slug);
  if (!LOGIN_RE.test(owner) || !SLUG_RE.test(slug)) return null;
  let dropped = Number.isInteger(d.dropped) && d.dropped > 0 ? d.dropped : 0;
  let cards = [...new Set((Array.isArray(d.cards) ? d.cards : []).map(String))].filter(id => !byId || byId.has(id) || (dropped++, false));
  let field = d.field ? String(d.field) : null;
  if (field && byId && !byId.has(field)) { field = null; dropped++; }
  if (field) cards = cards.filter(id => id !== field);   // listed once, as the field card
  return { owner, slug, updated: str(d.updated), state, private: false, name: line(d.name) || slug, description: str(d.description), cards, field, n: cards.length + (field ? 1 : 0), dropped };
}
export function privateEntry(d, state = "") {
  d = obj(d);
  const owner = str(d.owner), slug = str(d.slug);
  if (!LOGIN_RE.test(owner) || !SLUG_RE.test(slug) || !str(d.iv) || !str(d.data) || typeof obj(d.kdf).salt !== "string") return null;
  return { owner, slug, updated: str(d.updated), state, private: true, kdf: { ...obj(d.kdf) }, iv: d.iv, data: d.data };
}
/** data/decks.json -> {generated, decks: [public entries], private: [private entries]}; junk is skipped, never thrown. */
export function normalizeData(raw, byId = null) {
  raw = obj(raw);
  const decks = (Array.isArray(raw.decks) ? raw.decks : []).map(d => publicEntry(d, byId)).filter(Boolean);
  const priv = (Array.isArray(raw.private) ? raw.private : []).map(d => privateEntry(d)).filter(Boolean);
  return { generated: str(raw.generated), decks, private: priv };
}
/** A staged or just-published FILE object (what stage.decks holds) as an entry. */
export const entryOf = (file, slug, byId = null, state = "") => (isPrivate(file) ? privateEntry({ ...file, slug }, state) : publicEntry({ ...obj(file), slug }, byId, state));

// ---- filter and sort ---------------------------------------------------------------------------------
const label = d => { d = obj(d); return str(d.private ? d.slug : d.name || d.slug).toLowerCase(); };
const ownerOf = d => str(obj(d).owner).toLowerCase();
/** p = {q, owner, card, complete}; ctx = {byId, validate(d) -> {complete}} (private decks match on owner and slug only). */
export function filterDecks(list, p = {}, ctx = {}) {
  p = obj(p); ctx = obj(ctx);
  const q = line(p.q).toLowerCase(), owner = str(p.owner).toLowerCase();
  return (Array.isArray(list) ? list : []).filter(e => {
    const d = hand(e);
    if (owner && ownerOf(d) !== owner) return false;
    if (p.card && !usesCard(d, str(p.card))) return false;
    if (p.complete && (d.private || !ctx.validate?.(d)?.complete)) return false;
    if (!q) return true;
    const hay = [d.owner, d.slug, ...(d.private ? [] : [d.name, d.description, ...[...d.cards, d.field].map(id => ctx.byId?.get(id)?.name || "")])].join("\n").toLowerCase();
    return hay.includes(q);
  });
}
export function sortDecks(list, sort = "newest") {
  const newest = (a, b) => str(obj(b).updated).localeCompare(str(obj(a).updated)) || label(a).localeCompare(label(b));
  const by = {
    newest, name: (a, b) => label(a).localeCompare(label(b)) || newest(a, b),
    owner: (a, b) => ownerOf(a).localeCompare(ownerOf(b)) || newest(a, b),
  }[sort] || newest;
  return (Array.isArray(list) ? list : []).slice().sort(by);
}

// ---- HTML ---------------------------------------------------------------------------------------
// ctx = {byId: Map id -> card, img(card, width) -> url, validate(d) -> {checks, badCards, complete, count, slots}}
const stateFact = state => (state === "staged" ? `<span class="fact staged">Unpublished</span>` : state === "sent" ? `<span class="fact" data-tip="Published; the site is rebuilding">Publishing…</span>` : "");
const cardOf = (ctx, id) => (id && ctx.byId ? ctx.byId.get(id) : null) || null;
const byStars = (a, b) => (b.stars || 0) - (a.stars || 0) || String(a.name).localeCompare(String(b.name));
/** The hand's cards in page order: the field card, then creatures by stars, then items by stars, then anything else. */
export function handCards(d, ctx) {
  d = hand(d); ctx = obj(ctx);
  const cards = d.cards.map(id => cardOf(ctx, id)).filter(Boolean);
  const kind = k => cards.filter(c => c.type === k).sort(byStars);
  const rest = cards.filter(c => !HAND.some(g => g.kind === c.type)).sort(byStars);
  return [cardOf(ctx, d.field), ...HAND.flatMap(g => kind(g.kind)), ...rest].filter(Boolean);
}
/** "7 creatures, 10 items, field card Name" (the share pages say the same). */
export function handWords(d, ctx) {
  d = hand(d); ctx = obj(ctx);
  const cards = handCards(d, ctx).filter(c => c.id !== d.field);
  const parts = HAND.map(g => { const n = cards.filter(c => c.type === g.kind).length; return n ? plural(n, g.kind) : ""; }).filter(Boolean);
  const f = cardOf(ctx, d.field);
  if (f) parts.push(`field card ${f.name}`);
  return parts.join(", ") || "no cards";
}
const art = (ctx, c) => (c.img ? `<img loading="lazy" decoding="async" src="${esc(ctx.img(c, 240))}" alt="${esc(c.name)}" title="${esc(c.name)}">` : `<span class="noart" title="${esc(c.name)}"></span>`);
const updatedOn = d => (d.updated ? ` · ${esc(String(d.updated).slice(0, 10))}` : "");
/** One deck in the browser and on person pages (a private entry, should one be passed, is a lock and its slug: nothing else is in clear). */
export function deckTileHtml(d, ctx = {}) {
  d = hand(d); ctx = obj(ctx);
  const href = deckHash(d.owner, d.slug), owner = `<a href="#/u/${encodeURIComponent(d.owner)}">${esc(d.owner)}</a>`;
  if (d.private) return `<article class="dtile private"><a class="arts lock" href="${href}" aria-label="Private deck">🔒 Private</a>
    <div class="meta"><a class="name" href="${href}">Private deck</a><div class="sub">by ${owner} · <span class="kbd">${esc(d.slug)}</span>${updatedOn(d)}${stateFact(d.state)}</div></div></article>`;
  const cards = handCards(d, ctx), n = countOf(d), complete = !!ctx.validate?.(d)?.complete;
  return `<article class="dtile"><a class="arts" href="${href}" aria-label="${esc(d.name)}">${cards.slice(0, 4).map(c => art(ctx, c)).join("") || `<span class="noart empty-hand">No cards</span>`}</a>
    <div class="meta"><a class="name" href="${href}">${esc(d.name)}</a>${complete ? `<span class="ok" data-tip="A complete legal hand">✓</span>` : ""}
    <div class="sub">by ${owner} · ${plural(n, "card")}${updatedOn(d)}${stateFact(d.state)}</div></div></article>`;
}
export const tilesHtml = (list, ctx) => `<div class="deck-grid">${list.map(d => deckTileHtml(d, ctx)).join("")}</div>`;

/** The deck browser (#/decks): public decks only. A private deck is never listed, filtered or counted here; its owner's page
 *  and its own link reach it. list = every entry (published, staged, sent); p = {q, owner, sort, complete}; ctx + {error}. */
export function browserHtml(list, p = {}, ctx = {}) {
  list = (Array.isArray(list) ? list : []).filter(d => !obj(d).private); p = obj(p); ctx = obj(ctx);
  const owners = [...new Set(list.map(d => d.owner))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const shown = sortDecks(filterDecks(list, p, ctx), p.sort);
  return `<div class="decks">
    <div class="toolbar"><span class="result-count">${plural(shown.length, "deck")}${shown.length !== list.length ? ` of ${list.length}` : ""}</span>
      <input id="decks-q" type="search" placeholder="Name, owner, description or card…" value="${esc(p.q || "")}" aria-label="Filter decks">
      <select data-action="select-param" data-key="owner" aria-label="Owner"><option value="">Anyone</option>${owners.map(o => `<option value="${esc(o)}"${o.toLowerCase() === str(p.owner).toLowerCase() ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
      <label class="muted">Sort <select data-action="select-param" data-key="sort">${SORTS.map(([v, l]) => `<option value="${v}"${v === (p.sort || "newest") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" data-action="toggle-param" data-key="complete" data-value="1"${p.complete ? " checked" : ""}> complete hands only</label>
      <a class="fact" href="#/deck">Deck builder</a></div>
    ${p.card ? `<div class="active-filters"><button type="button" class="chip" data-action="remove-param" data-key="card">Using ${esc(cardOf(ctx, str(p.card))?.name || p.card)} ✕</button></div>` : ""}
    ${ctx.error ? `<p class="muted">Couldn't load the published decks (${esc(ctx.error)}). <a href="javascript:location.reload()">Reload</a></p>` : ""}
    ${!list.length ? `<div class="empty">No deck is published yet. Build a hand in the <a href="#/deck">deck builder</a> and press Publish.</div>`
      : !shown.length ? `<div class="empty">No deck matches.</div>`
      : tilesHtml(shown, ctx)}
  </div>`;
}

/** A card page's "Decks using this card": public decks only, newest first, the first `limit` as tiles. */
export function usingHtml(list, id, ctx = {}, limit = 6) {
  const using = sortDecks((Array.isArray(list) ? list : []).filter(d => usesCard(d, id)));
  if (!using.length) return "";
  return `<h3>Decks using this card <span class="muted">${using.length}</span></h3>${tilesHtml(using.slice(0, limit), ctx)}
    ${using.length > limit ? `<p><a href="#/decks?card=${encodeURIComponent(id)}">All ${using.length} decks using this card</a></p>` : ""}`;
}
/** The Cards tab's line for a search: how many public decks the deck browser finds for q, with a link there; "" for none. */
export function searchHitsHtml(list, q, ctx = {}) {
  q = line(q);
  const n = q ? filterDecks((Array.isArray(list) ? list : []).filter(d => !obj(d).private), { q }, ctx).length : 0;
  if (!n) return "";
  return `<p class="deck-hits muted">${n === 1 ? "1 public deck matches" : `${n} public decks match`} “${esc(q)}”. <a href="#/decks?q=${encodeURIComponent(q)}">Show ${n === 1 ? "it" : "them"}</a></p>`;
}

/** The hand grouped like the deck builder: creatures by stars, items by stars, the field card, then strays and gone ids. */
export function handHtml(d, ctx, bad = new Set()) {
  d = hand(d); ctx = obj(ctx); bad = bad instanceof Set ? bad : new Set();
  const cards = d.cards.map(id => cardOf(ctx, id)).filter(Boolean);
  const gone = d.cards.filter(id => !cardOf(ctx, id)).length;
  const slot = c => `<div class="slot filled${bad.has(c.id) ? " bad" : ""}" data-open="${esc(c.id)}" title="${esc(c.name)}">${c.img ? `<img loading="lazy" decoding="async" src="${esc(ctx.img(c, 240))}" alt="${esc(c.name)}">` : ""}<span class="slot-name">${esc(c.name)}</span></div>`;
  const group = (title, list, of) => (list.length ? `<div class="tier-title"><span>${esc(title)}</span><span class="muted">${list.length}${of ? ` / ${of}` : ""}</span></div><div class="slots">${list.map(slot).join("")}</div>` : "");
  const f = cardOf(ctx, d.field), stray = cards.filter(c => !HAND.some(g => g.kind === c.type)).sort(byStars);
  return `${HAND.map(g => group(g.label, cards.filter(c => c.type === g.kind).sort(byStars), g.tiers.reduce((s, [, n]) => s + n, 0))).join("")}
    ${f ? group("Field card", [f], 1) : ""}${group("Not allowed in a hand", stray)}
    ${gone ? `<p class="muted">${plural(gone, "card")} of this deck no longer exist.</p>` : ""}`;
}
/** Unpublish and Replace with… for the owner or an admin (ctx.canEdit; ctx.hands = my saved hands [{id, name, n}]). On the deck
 *  page and on a private deck's passphrase form: neither needs the passphrase (removing stages null, replacing re-encrypts). */
export function ownerPanelHtml(d, ctx = {}) {
  d = obj(d); ctx = obj(ctx);
  if (!ctx.canEdit) return "";
  const hands = (Array.isArray(ctx.hands) ? ctx.hands : []).map(h => { h = obj(h); return `<option value="${esc(h.id)}"${h.n ? "" : " disabled"}>${esc(h.name)} (${Number(h.n) || 0})</option>`; }).join("");
  const own = `data-owner="${esc(d.owner)}" data-slug="${esc(d.slug)}"${d.private ? ' data-private="1"' : ""}`;
  return `<div class="panel"><h3>${d.private ? "Owner · private" : "Owner"}</h3><div class="actions">
    <select data-action="deck-replace" ${own} aria-label="Replace with a saved hand"><option value="">Replace with…</option>${hands}</select>
    <button type="button" class="danger" data-action="deck-unpublish" ${own}>Unpublish</button></div>
    <p class="muted">Both go into your batch${d.private ? "; replacing asks for a passphrase again (a new one will do)" : ""}.</p></div>`;
}
/** One published deck (#/decks/<owner>/<slug>), public or opened. ctx + {canEdit, hands} (see ownerPanelHtml). */
export function deckPageHtml(d, ctx = {}) {
  d = hand(d); ctx = obj(ctx);
  const v = ctx.validate?.(d) || { checks: [], badCards: new Set(), complete: false, count: countOf(d), slots: 17 };
  return `<div class="deck deck-page">
    <section><div class="panel">
      <h2>${esc(d.name)}${d.private ? ` <span class="fact" data-tip="Opened with its passphrase; only the owner, file name and date are public">🔒 Private</span>` : ""}</h2>
      <div class="facts"><a class="fact" href="#/u/${encodeURIComponent(d.owner)}">by ${esc(d.owner)}</a>
        ${d.updated ? `<span class="fact" data-tip="Last published">updated ${esc(String(d.updated).slice(0, 10))}</span>` : ""}
        <span class="fact">${esc(handWords(d, ctx))}</span>${d.dropped ? `<span class="fact" data-tip="Ids the build didn't know">${plural(d.dropped, "card")} dropped</span>` : ""}${stateFact(d.state)}</div>
      ${d.description ? `<p class="deck-desc">${esc(d.description)}</p>` : ""}
      ${handHtml(d, ctx, v.badCards)}
    </div></section>
    <aside>
      <div class="panel"><h3>${v.complete ? "✅ Legal hand" : `Checks · ${v.count}/${v.slots} cards`}</h3><ul class="checks">${v.checks.map(c => `<li class="${c.ok ? "ok" : "err"}">${c.ok ? "✓" : "✗"} ${esc(c.text)}</li>`).join("")}</ul></div>
      <div class="panel"><h3>Use it</h3><div class="actions">
        <button type="button" class="primary" data-action="deck-save-copy">Save a copy to my decks</button>
        <button type="button" data-action="deck-page-share" title="The deck builder's share link">Share link</button>
        <button type="button" data-action="deck-page-text">Copy as text</button>
        <button type="button" data-action="deck-page-discord" title="Card names as links, ready to paste">Discord</button>
        <button type="button" data-action="deck-page-tts" title="Tabletop Simulator saved object">TTS save</button>
        <button type="button" data-action="deck-page-print">Print</button></div>
        ${d.private && d.remembered ? `<p class="muted">Passphrase remembered on this device. <button type="button" class="ghost" data-action="deck-forget">Forget</button></p>` : ""}</div>
      ${ownerPanelHtml(d, ctx)}
      <p><a href="#/decks">All decks</a></p>
    </aside></div>`;
}
/** The private deck's passphrase form; x = {error, noCrypto, canEdit, hands}: the owner or an admin gets the Owner panel here too. */
export function passFormHtml(d, x) {
  d = obj(d); x = obj(x); const { error = "", noCrypto = false } = x;
  return `<div class="profile"><div class="panel deck-pass">
    <h2>Private deck <span class="fact">🔒</span></h2>
    <div class="facts"><a class="fact" href="#/u/${encodeURIComponent(d.owner)}">by ${esc(d.owner)}</a><span class="fact"><span class="kbd">${esc(d.slug)}</span></span>${d.updated ? `<span class="fact">updated ${esc(String(d.updated).slice(0, 10))}</span>` : ""}${stateFact(d.state)}</div>
    ${noCrypto ? `<p class="err">Opening a private deck needs a secure page (https or localhost): this browser has no crypto.subtle here.</p>`
      : `<form id="deck-pass" autocomplete="off"><label for="deck-pass-in">This deck is private. Passphrase:</label>
        <input id="deck-pass-in" type="password" autocomplete="current-password" required aria-label="Passphrase">
        <button type="submit" class="primary">Open</button>
        <label class="check"><input type="checkbox" id="deck-pass-remember"> Remember on this device</label></form>
        <p class="err" id="deck-pass-err" aria-live="polite">${esc(error)}</p>`}
    <p><a href="#/decks">All decks</a></p></div>${ownerPanelHtml({ ...d, private: true }, x)}</div>`;
}
export const removedHtml = d => `<div class="empty">This deck is removed${d?.state === "sent" ? "; the site is rebuilding." : " in your unpublished batch."} <a href="#/decks">All decks</a></div>`;
export const missingHtml = () => `<div class="empty">No such deck. <a href="#/decks">All decks</a></div>`;

/** The publish dialog's form; x = {name, description, visibility, lock (slug and visibility fixed: a replacement), n, dropped}.
 *  edit.js fills #pd-path (the file path, "replaces …") and #pd-summary. */
export function publishFormHtml(x = {}) {
  x = obj(x);
  const vis = x.visibility === "private" ? "private" : "public", lock = !!x.lock, n = Number(x.n) || 0, dropped = Number(x.dropped) || 0;
  const radio = (v, l) => `<label class="check"><input type="radio" name="pd-vis" value="${v}"${vis === v ? " checked" : ""}${lock ? " disabled" : ""}> ${l}</label>`;
  return `<h3>${lock ? "Replace the published deck" : "Publish this hand"}</h3>
    <p class="muted">A copy of the hand as it is now (${plural(n, "card")})${dropped ? `; ${plural(dropped, "card")} that no longer exist are left out` : ""}. It goes into your batch and is published with it.</p>
    <form id="edit-form" class="edit-form publish-form" autocomplete="off">
      <div class="erow"><label for="pd-name">Name</label><div class="ein"><input id="pd-name" maxlength="${LIMITS.name}" value="${esc(x.name || "")}" required></div></div>
      <div class="erow"><label for="pd-desc">Description</label><div class="ein"><textarea id="pd-desc" rows="3" maxlength="${LIMITS.description}" placeholder="optional">${esc(x.description || "")}</textarea></div></div>
      <div class="erow"><label>Visibility</label><div class="ein">${radio("public", "Public")}${radio("private", "Private")}</div></div>
      <div id="pd-private"${vis === "private" ? "" : " hidden"}>
        <div class="erow"><label for="pd-pass">Passphrase</label><div class="ein"><input id="pd-pass" type="password" minlength="${LIMITS.passphrase}" autocomplete="new-password" placeholder="at least ${LIMITS.passphrase} characters"></div></div>
        <div class="erow"><label for="pd-pass2">Confirm</label><div class="ein"><input id="pd-pass2" type="password" autocomplete="new-password"></div></div>
        <p class="muted egroup-note">Anyone with the passphrase can open it; it cannot be recovered. The name, description and cards are encrypted; the file name, made from the name, stays public, so pick a bland one. It isn't listed with the public decks: your page and its own link lead to it.</p>
      </div>
      <p class="muted" id="pd-path"></p>
      <div class="edit-summary muted" id="pd-summary" aria-live="polite"></div>
      <div class="actions"><button type="submit" class="primary">Add to batch</button><button type="button" data-action="edit-cancel">Cancel</button></div>
    </form>`;
}
