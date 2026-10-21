// Profiles: site/profiles/<login>.json, made on the website and published with the edit batch (edit.js), read by
// build_site.py into data/users.json. Pure functions, plus the profile and users pages. All profile text is user-written:
// everything is escaped and only internal routes are linked.
import { esc } from "./text.js";
import { decode } from "./deck.js";

export const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;              // a GitHub login
export const LIMITS = { motto: 140, author: 60, facts: 12, label: 40, value: 200, deck: 2000 };
export const PICKS = [["favourite", "Favourite card"], ["hated", "Hated card"], ["favouriteItem", "Favourite item"], ["hatedItem", "Hated item"]];
export const ITEM_KINDS = new Set(["item", "aux item", "nme"]);
const line = s => String(s ?? "").split(/\s+/).filter(Boolean).join(" ");   // one line, single spaces

/** The profile's fields checked against the site's data: {profile (known fields only, cleaned), errors[]}.
 *  ctx = {cards: Map id -> card, series: Set, people: [author names]}. build_site.py clean_profile applies the same rules. */
export function validateProfile(raw, ctx) {
  raw = raw && typeof raw === "object" ? raw : {};
  const errors = [], p = { login: String(raw.login ?? "") };
  if (!LOGIN_RE.test(p.login)) errors.push("login: not a GitHub login");
  const author = line(raw.author);
  if (author) {
    const known = (ctx.people || []).find(x => x.toLowerCase() === author.toLowerCase());
    if (known) p.author = known; else errors.push(`Cards as: “${author}” isn't a name cards are credited to`);
  }
  const motto = line(raw.motto);
  if (motto.length > LIMITS.motto) errors.push(`Motto: at most ${LIMITS.motto} characters`); else if (motto) p.motto = motto;
  const series = line(raw.series);
  if (series) { if (ctx.series.has(series)) p.series = series; else errors.push(`Series: “${series}” isn't a known series`); }
  for (const [k, label] of PICKS) {
    const id = line(raw[k]);
    if (!id) continue;
    const c = ctx.cards.get(id);
    if (!c) errors.push(`${label}: “${id}” isn't a card`);
    else if (k.endsWith("Item") && !ITEM_KINDS.has(c.type)) errors.push(`${label}: ${c.name} isn't an item`);
    else p[k] = id;
  }
  const deck = line(raw.deck), hand = deck && deck.length <= LIMITS.deck && /^[A-Za-z0-9_-]+$/.test(deck) ? decode(deck) : null;   // atob would skip spaces; the build won't
  if (deck) { if (!hand) errors.push("Featured hand: not a deck builder share link"); else if (!hand.cards.length && !hand.field) errors.push("Featured hand: that hand is empty"); else p.deck = deck; }
  const facts = (Array.isArray(raw.facts) ? raw.facts : []).map(f => ({ label: line(f?.label), value: line(f?.value) })).filter(f => f.label || f.value);
  if (facts.length > LIMITS.facts) errors.push(`At most ${LIMITS.facts} label/value pairs`);
  facts.forEach((f, i) => {
    if (!f.label || !f.value) errors.push(`Pair ${i + 1}: needs a label and a value`);
    else if (f.label.length > LIMITS.label || f.value.length > LIMITS.value) errors.push(`Pair ${i + 1}: label up to ${LIMITS.label}, value up to ${LIMITS.value} characters`);
  });
  if (facts.length) p.facts = facts;
  if (typeof raw.updated === "string" && raw.updated) p.updated = raw.updated;
  return { profile: p, errors };
}

const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
/** The file: keys sorted, 2-space indent, trailing newline (what Python's json.dumps(sort_keys=True, indent=2, ensure_ascii=False) writes). */
export const profileFile = p => `${JSON.stringify(sortKeys(p), null, 2)}\n`;
/** A pasted deck link (…/d/#/deck/<code>) or a bare code -> the code. */
export const deckCode = text => (String(text ?? "").match(/#\/deck\/([A-Za-z0-9_-]+)/) || [, String(text ?? "").trim()])[1];
/** Published profiles with the unpublished ones applied; pending = Map lowercase login -> {profile | null (removed), state}. */
export function mergeUsers(published, pending) {
  const out = new Map(published.map(p => [p.login.toLowerCase(), { profile: p, state: "" }]));
  for (const [k, v] of pending) out.set(k, v);
  return [...out.values()].filter(x => x.profile).sort((a, b) => a.profile.login.localeCompare(b.profile.login, undefined, { sensitivity: "base" }));
}
export const cardsBy = (author, cards) => cards.filter(c => c.author === author && !c.dup).length;    // a duplicate counts once

// ---- pages -----------------------------------------------------------------------------------------
const stateFact = state => (state === "staged" ? `<span class="fact staged">Unpublished</span>`
  : state === "sent" ? `<span class="fact" data-tip="Published; the site is rebuilding">Publishing…</span>` : "");
const authorLink = (p, cards) => { const n = cardsBy(p.author, cards); return `<a class="fact" href="#/cards?author=${encodeURIComponent(p.author)}">${n} card${n === 1 ? "" : "s"} by ${esc(p.author)}</a>`; };

/** x = {login, profile | null, state, removed, own, canEdit, byId, cards, tile(card)} */
export function profileHtml(x) {
  const p = x.profile;
  if (!p) {
    const removed = x.state === "sent" ? "'s profile is removed; the site is rebuilding." : "'s profile is removed in your unpublished batch.";
    return `<div class="profile"><div class="empty">${esc(x.login)}${x.removed ? removed : ` has no profile${x.own ? " yet" : ""}.`}
      ${x.own ? `<p><button type="button" class="primary" data-action="profile-edit">${x.removed && x.state !== "sent" ? "Edit it instead" : "Make your profile"}</button></p>` : ""}
      <p><a href="#/users">All users</a></p></div></div>`;
  }
  const card = id => (id ? x.byId.get(id) : null);
  const picks = PICKS.filter(([k]) => card(p[k])).map(([k, label]) => `<div><div class="pick-label">${label}</div>${x.tile(card(p[k]))}</div>`).join("");
  const deck = p.deck ? decode(p.deck) : null;
  const hand = deck ? [...deck.cards, ...(deck.field ? [deck.field] : [])].map(card).filter(Boolean) : [];
  return `<div class="profile"><div class="panel">
    <h2>${esc(p.login)}</h2>
    <div class="facts">
      ${p.author ? authorLink(p, x.cards) : ""}
      ${p.series ? `<a class="fact" href="#/cards?series=${encodeURIComponent(p.series)}" data-tip="Series">${esc(p.series)}</a>` : ""}
      ${p.updated ? `<span class="fact" data-tip="Profile last changed">updated ${esc(p.updated.slice(0, 10))}</span>` : ""}
      ${stateFact(x.state)}
    </div>
    ${p.motto ? `<p class="motto">${esc(p.motto)}</p>` : ""}
    ${picks ? `<div class="picks">${picks}</div>` : ""}
    ${p.facts?.length ? `<dl class="pairs">${p.facts.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join("")}</dl>` : ""}
    ${deck ? `<div class="related"><h3>Featured hand: ${esc(deck.name)} <span class="muted">${hand.length}</span></h3>
      ${hand.length ? `<div class="strip">${hand.map(x.tile).join("")}</div>` : `<p class="muted">None of its cards exist any more.</p>`}
      <p><a href="#/deck/${esc(p.deck)}">Open in the deck builder</a></p></div>` : ""}
    <div class="actions">
      ${x.canEdit ? `<button type="button" data-action="profile-edit" data-login="${esc(p.login)}">Edit profile</button>` : ""}
      <button type="button" data-action="copy-user-link" data-login="${esc(p.login)}">Copy link</button>
      <a class="fact" href="#/users">All users</a>
    </div></div></div>`;
}

/** rows = mergeUsers(...); x = {cards, me, hasOwn} */
export function usersHtml(rows, x) {
  const n = rows.length;
  const row = ({ profile: p, state }) => `<tr><td><a href="#/u/${encodeURIComponent(p.login)}">${esc(p.login)}</a> ${stateFact(state)}</td>
    <td>${p.author ? `<a href="#/cards?author=${encodeURIComponent(p.author)}">${esc(p.author)}</a>` : ""}</td><td class="num">${p.author ? cardsBy(p.author, x.cards) : ""}</td>
    <td class="muted">${esc(p.motto || "")}</td></tr>`;
  return `<div class="profile">
    <div class="toolbar"><span class="result-count">${n} user${n === 1 ? "" : "s"} with a profile</span>
      ${x.me ? (x.hasOwn ? "" : `<button type="button" class="primary" data-action="profile-edit">Make your profile</button>`) : `<span class="muted">Sign in (top right) to make yours.</span>`}</div>
    ${n ? `<table class="data"><thead><tr><th>User</th><th>Cards as</th><th class="num">Cards</th><th>Motto</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`
      : `<div class="empty">Nobody has made a profile yet.</div>`}</div>`;
}
