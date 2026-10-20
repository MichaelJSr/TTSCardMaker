// The Tabletop Simulator save: read and write it the way TTS does (byte for byte), and the deck edits the Table tab stages.
export const SAVE_PATH = "TTS/Impossibility Simulator.json";
export const RULES_PATH = "TTS/decks.json";
const CARD_NAMES = ["Card", "CardCustom"];
const CARD_EXTRAS = ["States", "AttachedDecals", "ChildObjects", "Tags"];     // not copied onto new cards
const CARD_SCRIPTS = ["LuaScript", "LuaScriptState", "XmlUI", "GMNotes"];
const ORDER = Symbol("order");            // file order of keys JS would sort (numeric keys like CustomDeck ids)
const LINK = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(?:refs\/heads\/main|main|[0-9a-f]{7,40})\/(.+)$/;
const NUM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** A number kept as written: JSON.parse would turn 1.0 into 1 and 1.0E-05 into 0.00001. */
export class Num {
  constructor(text) { this.text = text; }
  valueOf() { return Number(this.text); }
}

// ---- parse / serialize ------------------------------------------------------------------------------
export function parse(text) {
  let i = 0;
  const fail = what => { throw new SyntaxError(`TTS save: ${what} at ${i}`); };
  const ws = () => { let c; while ((c = text.charCodeAt(i)) === 32 || c === 10 || c === 13 || c === 9) i++; };
  let escAt = text.indexOf("\\");                        // the next backslash: most strings have none
  const str = () => {                                      // at the opening quote
    let j = i + 1;
    for (;;) {
      const q = text.indexOf('"', j);
      if (q < 0) fail("unterminated string");
      if (escAt >= 0 && escAt < i) escAt = text.indexOf("\\", i);
      if (escAt < 0 || escAt > q) { const s = text.slice(i + 1, q); i = q + 1; return s; }
      let n = 0; for (let b = q - 1; text[b] === "\\"; b--) n++;
      if (n % 2 === 0) { const s = JSON.parse(text.slice(i, q + 1)); i = q + 1; return s; }
      j = q + 1;
    }
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const o = {}, keys = []; let numeric = false;
      ws(); if (text[i] === "}") { i++; return o; }
      for (;;) {
        ws(); if (text[i] !== '"') fail("expected a key");
        const k = str();
        if (k === "__proto__") fail("bad key");
        ws(); if (text[i] !== ":") fail("expected :"); i++;
        const v = value(); if (!Object.hasOwn(o, k)) keys.push(k); o[k] = v;
        if (!numeric && /^\d+$/.test(k)) numeric = true;
        ws(); if (text[i] === ",") { i++; continue; } if (text[i] === "}") { i++; break; } fail("expected , or }");
      }
      if (numeric) o[ORDER] = keys;
      return o;
    }
    if (c === "[") {
      i++;
      const a = [];
      ws(); if (text[i] === "]") { i++; return a; }
      for (;;) { a.push(value()); ws(); if (text[i] === ",") { i++; continue; } if (text[i] === "]") { i++; break; } fail("expected , or ]"); }
      return a;
    }
    if (c === '"') return str();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (!m) fail("unexpected character");
    i = NUM.lastIndex;
    const n = Number(m[0]);
    return Number.isInteger(n) && String(n) === m[0] ? n : new Num(m[0]);
  };
  const v = value();
  ws(); if (i < text.length) fail("trailing text");
  return v;
}

/** Python's repr(float): shortest round-trip digits, exponent form below 1e-4 and from 1e16, always a fraction. */
export function pyRepr(x) {
  if (!Number.isFinite(x)) throw new RangeError(`not a JSON number: ${x}`);
  if (x === 0) return 1 / x < 0 ? "-0.0" : "0.0";
  const neg = x < 0; if (neg) x = -x;
  const [m, e] = x.toExponential().split("e");
  const digits = m.replace(".", ""), exp = +e;
  let s;
  if (exp <= -5 || exp >= 16) s = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  else if (exp < 0) s = `0.${"0".repeat(-exp - 1)}${digits}`;
  else if (digits.length <= exp + 1) s = `${digits}${"0".repeat(exp + 1 - digits.length)}.0`;
  else s = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  return neg ? `-${s}` : s;
}
const keysOf = o => {
  const ks = Object.keys(o), order = o[ORDER];
  if (!order) return ks;
  const seen = new Set(order);
  return [...order.filter(k => Object.hasOwn(o, k)), ...ks.filter(k => !seen.has(k))];
};
const jsonStr = s => JSON.stringify(s).replace(/[\u0085\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** JSON the way TTS writes it (the bot's _dump): 2-space indent, ": ", UTF-8 as is, floats like 1.0 and 1.00179122E-05. */
export function dump(v, indent = "") {
  if (v instanceof Num) return v.text;
  if (v === null || v === true || v === false) return String(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyRepr(v).replace("e", "E");
  if (typeof v === "string") return jsonStr(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) return v.length ? `[\n${v.map(x => inner + dump(x, inner)).join(",\n")}\n${indent}]` : "[]";
  const keys = keysOf(v);
  return keys.length ? `{\n${keys.map(k => `${inner}${JSON.stringify(k)}: ${dump(v[k], inner)}`).join(",\n")}\n${indent}}` : "{}";
}
export function clone(v) {
  if (v instanceof Num || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  if (v[ORDER]) o[ORDER] = v[ORDER].slice();
  return o;
}

// ---- the save's objects -----------------------------------------------------------------------------
/** Every object with its chain of containers (outermost first), including States. */
export function* walk(objects, parents = []) {
  for (const o of objects || []) {
    yield [o, parents];
    yield* walk(o.ContainedObjects, [...parents, o]);
    for (const s of Object.values(o.States || {})) yield* walk([s], [...parents, o]);
  }
}
export const isCard = o => CARD_NAMES.includes(o.Name);
export const isDeck = o => o.Name === "Deck";
export const isBag = o => /Bag$/.test(o.Name || "");
export const idOf = card => Math.floor((card.CardID || 0) / 100);
/** The card's own CustomDeck entry: under CardID / 100, else the first one (stale key). */
export function entry(card) {
  const cd = card.CustomDeck || {};
  return cd[String(idOf(card))] || Object.values(cd)[0] || null;
}
/** Repo path of the card's face, or null. */
export function facePath(card) {
  const m = LINK.exec(entry(card)?.FaceURL || "");
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}
export const pos = o => ({ x: +(o.Transform?.posX ?? 0), z: +(o.Transform?.posZ ?? 0) });
export const urlPath = p => p.split("/").map(encodeURIComponent).join("/");
export const randomGuid = () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");

/** The bot's _glob: * stays inside one folder, ** crosses folders, ? is one character. */
const glob = pattern => new RegExp(`^${pattern.split(/(\*\*|\*|\?)/).map(t => ({ "**": ".*", "*": "[^/]*", "?": "[^/]" })[t] ?? t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}$`);
const inFolders = (rule, path) => (rule.folders || []).some(f => glob(f).test(path));
/** Whether a deck rule covers a repo path, as the bot's _rule_cards reads it: include, else folders minus exclude. */
export const covers = (rule, path) => (rule.include || []).includes(path) || (!(rule.exclude || []).includes(path) && inFolders(rule, path));
/** A deck the bot keeps in step with its rule (the others it leaves alone). */
export const synced = rule => !!(rule && !rule.partial && rule.count);
/**
 * TTS/decks.json after the applied edits, judged on the edited save (doc) the way the bot's _sync_decks judges a synced deck:
 * a face no card in the deck shows any more is excluded from its rule (one copy of several leaving needs nothing), a face
 * present that the rule doesn't cover is included. Returns the new rules, how many entries changed and a note per edit.
 */
export function fixRules(rules, ops, doc) {
  const out = clone(rules), notes = new Map(), faces = new Map();     // deck GUID -> faces its cards show after the edits
  let ix = null;
  const shows = (guid, png) => {
    if (!faces.has(guid)) { ix ||= index(doc); faces.set(guid, new Set((ix.decks.get(guid)?.deck.ContainedObjects || []).map(facePath))); }
    return faces.get(guid).has(png);
  };
  const list = (rule, k) => rule[k] || (rule[k] = []);
  const drop = (rule, k, path) => { const i = (rule[k] || []).indexOf(path); if (i < 0) return; rule[k].splice(i, 1); if (!rule[k].length) delete rule[k]; };
  const fix = (op, guid, keep) => {
    const rule = out.decks?.[guid]?.rule;
    if (!op.png || !synced(rule) || covers(rule, op.png) === keep || shows(guid, op.png) !== keep) return;
    if (keep) { drop(rule, "exclude", op.png); if (!inFolders(rule, op.png)) list(rule, "include").push(op.png); }
    else { drop(rule, "include", op.png); if (inFolders(rule, op.png)) list(rule, "exclude").push(op.png); }
    const label = `‘${out.decks[guid].name || guid}’ (${rule.kind || "?"}${rule.stars?.length ? ` ${rule.stars.join("/")}★` : ""})`;
    notes.set(op, `${notes.has(op) ? `${notes.get(op)}; ` : ""}rule of ${label} now ${keep ? "includes" : "excludes"} ${op.name || op.png}`);
  };
  for (const op of ops.slice().reverse()) {                              // the note goes on the edit that tips the rule (the last copy out)
    if (op.t === "remove" || op.t === "move") fix(op, op.deck, false);
    if (op.t === "move" || op.t === "copy") fix(op, op.to, true);
    if (op.t === "add") fix(op, op.deck, true);
  }
  const diff = (a = [], b = []) => a.filter(x => !b.includes(x)).length + b.filter(x => !a.includes(x)).length;
  let changed = 0;                                                       // entries that differ in the end (an edit undone counts 0)
  for (const g of Object.keys(out.decks || {})) for (const k of ["include", "exclude"]) changed += diff(rules.decks[g].rule?.[k], out.decks[g].rule?.[k]);
  return { rules: out, changed, notes };
}

/** Decks by GUID (unique; card GUIDs repeat), every GUID, and the highest CustomDeck id. */
export function index(doc) {
  const decks = new Map(), guids = new Set();
  let top = 0;
  for (const [o, parents] of walk(doc.ObjectStates)) {
    guids.add(o.GUID);
    if (isDeck(o)) decks.set(o.GUID, { deck: o, parents });
    if (Number.isInteger(o.CardID)) top = Math.max(top, idOf(o));
    for (const k of Object.keys(o.CustomDeck || {})) if (/^\d+$/.test(k)) top = Math.max(top, +k);
  }
  return { decks, guids, top };
}

// ---- staged edits ------------------------------------------------------------------------------------
// Keyed by GUID so they re-apply to a fresher save; nth = which of the deck's cards with that GUID (copies share GUIDs).
//   {t:"remove", deck, card, nth, png}       {t:"move"|"copy", deck, card, nth, png, to, guid}
//   {t:"add", deck, png, name, guid, back}   {t:"rename", deck, name}      {t:"up"|"down", deck, card, nth, png}
// png (the face's repo path, when known) guards against a reused GUID; the card is skipped when it shows another face.
// A new card is built as the bot builds one: a sibling copied, fresh GUID, CustomDeck id above the highest in the save.
export class Skipped extends Error {}
export function applyOps(doc, ops, { raw = "", random = randomGuid } = {}) {
  const applied = [], skipped = [], marks = new Map(), ix = index(doc);   // marks: new object -> "added" | "moved"
  for (const op of ops) {
    try { applyOp(doc, op, raw, random, marks, ix); applied.push(op); }
    catch (e) { if (!(e instanceof Skipped)) throw e; skipped.push({ op, why: e.message }); }
  }
  return { applied, skipped, marks };
}
function applyOp(doc, op, raw, random, marks, ix) {
  const deckOf = guid => { const d = ix.decks.get(guid); if (!d) throw new Skipped(`deck ${guid} is gone`); return d.deck; };
  const deck = deckOf(op.deck), cards = deck.ContainedObjects || (deck.ContainedObjects = []);
  const cardAt = () => {
    const same = cards.filter(c => c.GUID === op.card && (!op.png || facePath(c) === op.png)), c = same[op.nth || 0] || same[0];
    if (!c) throw new Skipped(`${op.name || op.card} is no longer in the deck`);
    return c;
  };
  const fresh = want => {
    if (want && !ix.guids.has(want)) { ix.guids.add(want); return want; }
    for (;;) { const g = random(); if (!ix.guids.has(g)) { ix.guids.add(g); return g; } }
  };
  switch (op.t) {
    case "rename": deck.Nickname = op.name; return;
    case "up": case "down": {
      const c = cardAt(), i = cards.indexOf(c), j = i + (op.t === "up" ? -1 : 1);
      if (j < 0 || j >= cards.length) return;
      cards[i] = cards[j]; cards[j] = c; sync(deck); return;
    }
    case "remove": { const c = cardAt(); cards.splice(cards.indexOf(c), 1); sync(deck); return; }
    case "move": {
      const c = cardAt(), to = deckOf(op.to);
      cards.splice(cards.indexOf(c), 1); sync(deck);
      place(to, c, ix, fresh, op.guid); marks.set(c, "moved"); sync(to); return;
    }
    case "copy": {
      const c = cardAt(), to = deckOf(op.to), n = newCard(c, entry(c), c.Nickname);
      place(to, n, ix, fresh, op.guid); marks.set(n, "added"); sync(to); return;
    }
    case "add": {
      const sibling = cards[cards.length - 1] || anyCard(doc);
      if (!sibling) throw new Skipped("no card in the save to copy the shape from");
      const base = entry(sibling) || {};
      const face = { ...clone(base), FaceURL: raw + urlPath(op.png), BackURL: (cards.length ? "" : op.back) || base.BackURL || "", NumWidth: 1, NumHeight: 1 };
      const n = newCard(sibling, face, op.name);
      place(deck, n, ix, fresh, op.guid); marks.set(n, "added"); sync(deck); return;
    }
    default: throw new Skipped(`unknown edit ${op.t}`);
  }
}
function newCard(sibling, face, name) {
  const card = clone(sibling);
  card.GUID = ""; card.Nickname = name; card.Description = "";
  for (const k of CARD_SCRIPTS) if (k in card) card[k] = "";
  for (const k of CARD_EXTRAS) delete card[k];
  card.CustomDeck = { [String(idOf(card))]: clone(face) };
  return card;
}
/** Append a card to a deck: an id the deck doesn't use for another image (fresh for new cards), a GUID the deck doesn't have. */
function place(deck, card, ix, fresh, guid) {
  const cards = deck.ContainedObjects || (deck.ContainedObjects = []), cd = deck.CustomDeck || (deck.CustomDeck = {});
  const face = entry(card);
  let id = idOf(card);
  const same = Object.keys(cd).find(k => cd[k].FaceURL === face.FaceURL);
  if (same) id = +same;                                                    // the deck already shows this face
  else if (!card.GUID || (cd[id] && cd[id].FaceURL !== face.FaceURL)) id = ++ix.top;   // new card, or the id means another image here
  ix.top = Math.max(ix.top, id);
  card.CardID = id * 100;
  card.CustomDeck = { [String(id)]: clone(cd[String(id)] || face) };     // the deck's entry (its back) wins
  if (!cd[String(id)]) cd[String(id)] = clone(face);
  if (!card.GUID || cards.some(c => c.GUID === card.GUID)) card.GUID = fresh(guid);
  cards.push(card);
}
/** DeckIDs = the cards' CardIDs in order; CustomDeck holds exactly the ids in use. */
function sync(deck) {
  const cards = deck.ContainedObjects || [], cd = deck.CustomDeck || {};
  deck.DeckIDs = cards.map(c => c.CardID);
  const used = new Set(cards.map(c => String(idOf(c))));
  for (const k of Object.keys(cd)) if (!used.has(k)) delete cd[k];
}
function anyCard(doc) {
  for (const [o] of walk(doc.ObjectStates)) if (isCard(o) && o.CustomDeck) return o;
  return null;
}
