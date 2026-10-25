// Constructed hand builder. Rules from the rulebook ("03 Setting Up") and site/Constructed Ban List.txt.
import { esc, plain, norm } from "./text.js";

export const HAND = [
  { kind: "creature", label: "Creatures", tiers: [[5, 1], [4, 2], [3, 3], [2, 1]] },
  { kind: "item", label: "Items", tiers: [[4, 2], [3, 3], [2, 3], [1, 2]] },
];
export const FIELD_MAX_STARS = 3;
const SLOTS = HAND.reduce((n, g) => n + g.tiers.reduce((m, [, k]) => m + k, 0), 0);

// ---- storage -------------------------------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 10);
export function loadDecks() {
  let decks = [];
  try { decks = JSON.parse(localStorage.getItem("decks") || "[]"); } catch { decks = []; }
  if (!decks.length) decks = [{ id: uid(), name: "My hand", cards: [], field: null }];
  return decks;
}
export function saveDecks(decks) { localStorage.setItem("decks", JSON.stringify(decks)); }
export function activeDeck(decks) {
  const id = localStorage.getItem("activeDeck");
  return decks.find(d => d.id === id) || decks[0];
}
export function setActive(deck) { localStorage.setItem("activeDeck", deck.id); }
export function newDeck(decks, name = "New hand", cards = [], field = null) {
  const d = { id: uid(), name, cards, field };
  decks.push(d); saveDecks(decks); setActive(d);
  return d;
}

// ---- share codes ---------------------------------------------------------------------------------
export function encode(deck) {
  const json = JSON.stringify({ n: deck.name, c: deck.cards, f: deck.field || undefined });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(code) {
  try {
    const json = decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))));
    const o = JSON.parse(json);
    return { name: String(o.n || "Shared hand"), cards: Array.isArray(o.c) ? o.c.map(String) : [], field: o.f ? String(o.f) : null };
  } catch { return null; }
}

// ---- rules ---------------------------------------------------------------------------------------
export function groupOf(card) { return HAND.find(g => g.kind === card.type) || null; }
export function need(kind, stars) {
  const g = HAND.find(x => x.kind === kind);
  const t = g && g.tiers.find(([s]) => s === stars);
  return t ? t[1] : 0;
}

/** Try to add a card. Returns an error message, or "" on success. */
export function addCard(deck, card, byId) {
  if (deck.cards.includes(card.id) || deck.field === card.id) return `${card.name} is already in this hand.`;
  if (card.type === "field") {
    if ((card.stars || 0) > FIELD_MAX_STARS) return `Only a field card of ${FIELD_MAX_STARS}★ or less can start in the shop.`;
    deck.field = card.id; return "";
  }
  const g = groupOf(card);
  if (!g) return `${card.name} can't go in a starting hand (creatures, items and one field card only).`;
  const room = need(card.type, card.stars);
  if (!room) return `A starting hand has no ${card.stars ?? "?"}★ ${card.type}s.`;
  const inTier = deck.cards.map(id => byId.get(id)).filter(c => c && c.type === card.type && c.stars === card.stars).length;
  if (inTier >= room) return `The hand already has its ${room} ${card.stars}★ ${card.type}${room > 1 ? "s" : ""}. Remove one first.`;
  deck.cards.push(card.id);
  return "";
}
export function removeCard(deck, id) {
  if (deck.field === id) deck.field = null;
  deck.cards = deck.cards.filter(x => x !== id);
}

/** All checks for a hand: [{ok, text}] plus per-card problems. */
export function validate(deck, byId, banned) {
  const out = [], badCards = new Set();
  const cards = deck.cards.map(id => byId.get(id)).filter(Boolean);
  const missing = deck.cards.filter(id => !byId.has(id));
  if (missing.length) out.push({ ok: false, text: `${missing.length} card(s) gone: ${missing.join(", ")}` });
  for (const g of HAND) {
    for (const [stars, n] of g.tiers) {
      const have = cards.filter(c => c.type === g.kind && c.stars === stars);
      const label = `${n} × ${stars}★ ${g.kind === "item" ? "item" : "creature"}${n > 1 ? "s" : ""}`;
      if (have.length === n) out.push({ ok: true, text: label });
      else if (have.length < n) out.push({ ok: false, text: `${label}: ${n - have.length} missing` });
      else { out.push({ ok: false, text: `${label}: ${have.length - n} too many` }); have.slice(n).forEach(c => badCards.add(c.id)); }
    }
  }
  const stray = cards.filter(c => !groupOf(c) || !need(c.type, c.stars));
  stray.forEach(c => badCards.add(c.id));
  if (stray.length) out.push({ ok: false, text: `Not allowed in a hand: ${stray.map(c => c.name).join(", ")}` });
  const bannedHere = [...cards, byId.get(deck.field)].filter(c => c && banned.has(c.id));
  bannedHere.forEach(c => badCards.add(c.id));
  out.push(bannedHere.length
    ? { ok: false, text: `Banned in constructed: ${bannedHere.map(c => `${c.name} (${banned.get(c.id)})`).join("; ")}` }
    : { ok: true, text: "No banned cards" });
  const field = byId.get(deck.field);
  if (field) out.push(field.stars > FIELD_MAX_STARS ? { ok: false, text: `Field card must be ${FIELD_MAX_STARS}★ or less` } : { ok: true, text: `Field card: ${field.name}` });
  const complete = out.every(r => r.ok) && cards.length === SLOTS;
  return { checks: out, badCards, complete, count: cards.length, slots: SLOTS };
}

/** Fill the rest of the hand with random legal, unbanned cards. */
export function randomFill(deck, cards, banned) {
  const inHand = new Set(deck.cards);
  for (const g of HAND) for (const [stars, n] of g.tiers) {
    let have = deck.cards.filter(id => cards.find(c => c.id === id && c.type === g.kind && c.stars === stars)).length;
    const pool = cards.filter(c => c.type === g.kind && c.stars === stars && c.parsed !== false && !banned.has(c.id) && !inHand.has(c.id));
    while (have < n && pool.length) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      deck.cards.push(c.id); inHand.add(c.id); have++;
    }
  }
  if (!deck.field) {
    const fields = cards.filter(c => c.type === "field" && (c.stars || 0) <= FIELD_MAX_STARS && !banned.has(c.id));
    if (fields.length) deck.field = fields[Math.floor(Math.random() * fields.length)].id;
  }
}

// ---- text import / export ------------------------------------------------------------------------
export function toText(deck, byId) {
  const lines = [`# ${deck.name}`];
  for (const g of HAND) {
    lines.push(`${g.label}:`);
    for (const [stars] of g.tiers)
      deck.cards.map(id => byId.get(id)).filter(c => c && c.type === g.kind && c.stars === stars)
        .forEach(c => lines.push(`${stars}★ ${c.name}`));
  }
  const f = byId.get(deck.field);
  if (f) lines.push(`Field: ${f.name}`);
  return lines.join("\n");
}
export function fromText(text, cards) {
  const lookup = new Map();
  for (const c of cards) { lookup.set(norm(c.name), c); for (const a of c.aliases || []) if (!lookup.has(norm(a))) lookup.set(norm(a), c); }
  const deck = { name: "Imported hand", cards: [], field: null }, unknown = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith("#")) { deck.name = line.replace(/^#+\s*/, "") || deck.name; continue; }
    if (/^(creatures|items):?$/i.test(line)) continue;
    const isField = /^field\s*:/i.test(line);
    const name = line.replace(/^field\s*:\s*/i, "").replace(/^\d+\s*[x×]\s*/i, "").replace(/^\d+\s*★\s*/, "").trim();
    const c = lookup.get(norm(name));
    if (!c) { unknown.push(name); continue; }
    if (isField || c.type === "field") deck.field = c.id;
    else if (!deck.cards.includes(c.id)) deck.cards.push(c.id);
  }
  return { deck, unknown };
}

// ---- Tabletop Simulator saved object -------------------------------------------------------------
const guid = () => Math.random().toString(16).slice(2, 8);
const urlPath = p => p.split("/").map(encodeURIComponent).join("/");
/** raw (.../main/) at the commit that last changed the file, as the TTS save links it: TTS has that image cached. */
const pinned = (raw, pin) => (pin ? raw.replace(/[^/]+\/$/, `${pin}/`) : raw);
function ttsCard(card, key, raw, back, x) {
  const ratio = card.th && card.tw ? card.th / card.tw : 1.5;
  const custom = { FaceURL: pinned(raw, card.pin) + urlPath(card.png), BackURL: back, NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
  return {
    Name: "Card", GUID: guid(), CardID: key * 100, Nickname: card.name, Description: plain(card.ability || ""),
    Transform: { posX: x, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: +(ratio / 1.4).toFixed(3) },
    ColorDiffuse: { r: 0.713, g: 0.713, b: 0.713 }, Locked: false, Grid: true, Snap: true, Autoraise: true, Sticky: true,
    Tooltip: true, HideWhenFaceDown: true, Hands: true, SidewaysCard: false, CustomDeck: { [key]: custom },
  };
}
function ttsPile(nickname, cards, startKey, raw, back, x) {
  const objs = cards.map((c, i) => ttsCard(c, startKey + i, raw, back, x));
  if (objs.length === 1) return objs[0];
  const deck = {
    Name: "Deck", GUID: guid(), Nickname: nickname, Description: "",
    Transform: { ...objs[0].Transform }, ColorDiffuse: objs[0].ColorDiffuse, Locked: false, Grid: true, Snap: true,
    Autoraise: true, Sticky: true, Tooltip: true, HideWhenFaceDown: true, Hands: false, SidewaysCard: false,
    DeckIDs: objs.map(o => o.CardID), CustomDeck: Object.assign({}, ...objs.map(o => o.CustomDeck)), ContainedObjects: objs,
  };
  return deck;
}
/** pins: {repo path: commit} for the card backs (build_site.py). */
export function ttsSave(deck, byId, raw, pins = {}) {
  const backUrl = path => pinned(raw, pins[path]) + path;
  const cards = deck.cards.map(id => byId.get(id)).filter(c => c && c.png);
  const creatures = cards.filter(c => c.type === "creature").sort((a, b) => b.stars - a.stars);
  const items = cards.filter(c => c.type !== "creature").sort((a, b) => b.stars - a.stars);
  const field = byId.get(deck.field);
  const objects = [];
  if (creatures.length) objects.push(ttsPile(`${deck.name} — creatures`, creatures, 1, raw, backUrl("MDW/cardback.png"), -4));
  if (items.length) objects.push(ttsPile(`${deck.name} — items`, items, 101, raw, backUrl("MDW/cardback_item.png"), 0));
  if (field && field.png) objects.push(ttsCard(field, 201, raw, backUrl("MDW/cardback_item.png"), 4));
  return {
    SaveName: deck.name, GameMode: "", Gravity: 0.5, PlayArea: 0.5, Date: new Date().toLocaleString(), Table: "", Sky: "",
    Note: "", Rules: "", XmlUI: "", LuaScript: "", LuaScriptState: "", ObjectStates: objects, TabStates: {}, VersionNumber: "",
  };
}

export function download(name, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function printSheet(deck, byId, raw) {
  const cards = [...deck.cards, deck.field].map(id => byId.get(id)).filter(c => c && c.png);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><title>${esc(deck.name)}</title><style>
    body{margin:8mm;font:12px system-ui} .sheet{display:flex;flex-wrap:wrap;gap:2mm} img{width:63mm;height:auto;break-inside:avoid}
    @media print{.hint{display:none}}</style><p class="hint">${cards.length} cards — use your browser's Print (⌘/Ctrl+P).</p>
    <div class="sheet">${cards.map(c => `<img src="${esc(raw + urlPath(c.png))}" alt="${esc(c.name)}">`).join("")}</div>`);
  w.document.close();
  return true;
}
