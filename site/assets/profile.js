// People: profiles (site/profiles/<login>.json, made on the website and published with the edit batch (edit.js), read by
// build_site.py into data/users.json) and contributions (data/contributions.json: cards credited, edit batches published
// and card commits per person, from build_site.py contributions()). Pure functions, plus the person page and the People
// table. All profile text is user-written: everything is escaped and only internal routes are linked.
import { esc } from "./text.js";
import { decode } from "./deck.js";

export const RECENT_CARDS = 24;                                             // the person page's newest cards

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
const noDate = p => Object.fromEntries(Object.entries(p || {}).filter(([k]) => k !== "updated"));
/** The same profile, whatever the key order and the publish date (the build and the form order the keys differently). */
export const sameProfile = (a, b) => profileFile(noDate(a)) === profileFile(noDate(b));
/** A pasted deck link (…/d/#/deck/<code>) or a bare code -> the code. */
export const deckCode = text => (String(text ?? "").match(/#\/deck\/([A-Za-z0-9_-]+)/) || [, String(text ?? "").trim()])[1];
/** Published profiles with the unpublished ones applied; pending = Map lowercase login -> {profile | null (removed), state}. */
export function mergeUsers(published, pending) {
  const out = new Map(published.map(p => [p.login.toLowerCase(), { profile: p, state: "" }]));
  for (const [k, v] of pending) out.set(k, v);
  return [...out.values()].filter(x => x.profile).sort((a, b) => a.profile.login.localeCompare(b.profile.login, undefined, { sensitivity: "base" }));
}
/** The cards credited to a name, as the Author filter counts them: a duplicate counts once, hidden cards don't. */
export const cardsOf = (author, cards) => (author ? cards.filter(c => c.author === author && !c.dup && !c.hidden) : []);
export const cardsBy = (author, cards) => cardsOf(author, cards).length;
/** The Cards panel's facts for a person's cards: kinds [[kind, n]] by count (ties in `kinds` order), the three biggest
 *  series [[name, n]], the newest card (by fs, the first upload; null when no card has one) and the `recent` newest
 *  cards (fs desc, cards without fs last, then name). kindOf(card) groups status effects (app.js kindOf). */
export function cardFacts(list, { kindOf = c => c.type, kinds = [], recent = RECENT_CARDS } = {}) {
  const count = (f, m = new Map()) => { for (const c of list) { const k = f(c); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
  const order = new Map(kinds.map(([k], i) => [k, i]));
  const rank = k => (order.has(k) ? order.get(k) : kinds.length);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const newest = list.slice().sort((a, b) => (b.fs || 0) - (a.fs || 0) || byName(a, b));
  return {
    kinds: [...count(kindOf)].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0])),
    series: [...count(c => c.series)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3),
    newest: newest[0]?.fs ? newest[0] : null,
    recent: newest.slice(0, recent),
  };
}

// ---- pages -----------------------------------------------------------------------------------------
const stateFact = state => (state === "staged" ? `<span class="fact staged">Unpublished</span>`
  : state === "sent" ? `<span class="fact" data-tip="Published; the site is rebuilding">Publishing…</span>` : "");
const authorLink = (p, cards) => { const n = cardsBy(p.author, cards); return `<a class="fact" href="#/cards?author=${encodeURIComponent(p.author)}">${n} card${n === 1 ? "" : "s"} by ${esc(p.author)}</a>`; };

/** x = {login, profile | null, state, removed, own, canEdit, byId, cards, tile(card), preview?}; preview: the editor's live
 *  preview, without the buttons and the unpublished state. */
export function profileHtml(x) {
  const p = x.profile;
  if (!p) {
    const removed = x.state === "sent" ? "'s profile is removed; the site is rebuilding." : "'s profile is removed in your unpublished batch.";
    return `<div class="profile"><div class="empty">${esc(x.login)}${x.removed ? removed : ` has no profile${x.own ? " yet" : ""}.`}
      ${x.own ? `<p><button type="button" class="primary" data-action="profile-edit">${x.removed && x.state !== "sent" ? "Edit it instead" : "Make your profile"}</button></p>` : ""}
      <p><a href="#/users">All people</a></p></div></div>`;
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
      ${x.preview ? "" : stateFact(x.state)}
    </div>
    ${p.motto ? `<p class="motto">${esc(p.motto)}</p>` : ""}
    ${picks ? `<div class="picks">${picks}</div>` : ""}
    ${p.facts?.length ? `<dl class="pairs">${p.facts.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join("")}</dl>` : ""}
    ${deck ? `<div class="related"><h3>Featured hand: ${esc(deck.name)} <span class="muted">${hand.length}</span></h3>
      ${hand.length ? `<div class="strip">${hand.map(x.tile).join("")}</div>` : `<p class="muted">None of its cards exist any more.</p>`}
      <p><a href="#/deck/${esc(p.deck)}">Open in the deck builder</a></p></div>` : ""}
    ${x.preview ? "" : `<div class="actions">
      ${x.canEdit ? `<button type="button" data-action="profile-edit" data-login="${esc(p.login)}">Edit profile</button>` : ""}
      <button type="button" data-action="copy-user-link" data-login="${esc(p.login)}">Copy link</button>
      <a class="fact" href="#/users">All people</a>
    </div>`}</div></div>`;
}

// ---- contributions (data/contributions.json) ----------------------------------------------------------
// person = {key, logins[], cards, edits, commits, first, last, recent[[ts, subject, nCards]]}; key = the name cards credit
export const TITLES = [["cards", "Top card maker", "Most cards"], ["edits", "Top editor", "Most edits: commits to Card Edits.json, published on the website or by hand"],
  ["commits", "Top committer", "Most commits that added or changed a card (moves and rulebook pages don't count)"]];          // the top count per column; ties share; build_site.py TITLES
const TITLE_TIP = Object.fromEntries(TITLES.map(([, title, tip]) => [title, tip]));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lc = s => String(s ?? "").toLowerCase();
const hasLogin = (person, login) => person.logins.some(l => lc(l) === lc(login));
/** Map key -> titles: the top count in each of TITLES' columns; ties share; nobody at 0. */
export function titlesOf(people) {
  const out = new Map(people.map(p => [p.key, []]));
  for (const [field, title] of TITLES) {
    const top = Math.max(0, ...people.map(p => p[field] || 0));
    if (top) for (const p of people) if ((p[field] || 0) === top) out.get(p.key).push(title);
  }
  return out;
}
/** The person a profile belongs to: its login is one of theirs, or its author field is their key. */
export const personOf = (profile, people) => people.find(p => hasLogin(p, profile.login) || (profile.author && p.key === profile.author)) || null;
/** A person by key or by one of their logins, without case. */
export const findPerson = (arg, people) => people.find(p => lc(p.key) === lc(arg) || hasLogin(p, arg)) || null;
/** The People table's rows: contributors with their profile (if any), then profiles without contributions; by cards,
 *  then card commits, then edits, then name. users = mergeUsers(...). */
export function peopleRows(people, users) {
  const rows = people.map(person => ({ key: person.key, person, profile: null, state: "" }));
  for (const { profile, state } of users) {
    const person = personOf(profile, people), row = person && rows.find(r => r.person === person && !r.profile);
    if (row) Object.assign(row, { profile, state }); else rows.push({ key: profile.login, person: null, profile, state });
  }
  const n = (r, k) => r.person?.[k] || 0;
  return rows.sort((a, b) => n(b, "cards") - n(a, "cards") || n(b, "commits") - n(a, "commits") || n(b, "edits") - n(a, "edits")
    || a.key.localeCompare(b.key, undefined, { sensitivity: "base" }));
}
const titleChips = (key, titles) => (titles.get(key) || []).map(t => `<span class="fact" data-tip="${esc(TITLE_TIP[t] || "")}">${esc(t)}</span>`).join(" ");

/** The contributions of one person: a facts row, their recent edits (cards.json editBy, the last batch per card) and
 *  their recent card commits. x = {cards, available, titles (Map), date(ts)} */
export function contributionsHtml(p, x) {
  const edits = x.cards.filter(c => c.editBy && hasLogin(p, c.editBy)).sort((a, b) => (b.editAt || "").localeCompare(a.editAt || "")).slice(0, 10);
  const facts = [
    p.cards ? `<a class="fact" href="#/cards?author=${encodeURIComponent(p.key)}">${plural(p.cards, "card")} by ${esc(p.key)}</a>` : "",
    p.edits ? `<span class="fact" data-tip="Commits to Card Edits.json: batches published on the website, or by hand">${plural(p.edits, "edit")}</span>` : "",
    p.commits ? `<span class="fact" data-tip="Commits that added or changed a card's PSD or PNG; moves and rulebook pages don't count">${plural(p.commits, "card commit")}${p.first ? ` since ${esc(x.date(p.first))}` : ""}</span>` : "",
    titleChips(p.key, x.titles),
  ].join("");
  return `<div class="facts">${facts}</div>
    ${x.available ? "" : `<p class="muted">Commits aren't in this build; edits are counted from Card Edits.json, which keeps one batch per card.</p>`}
    ${edits.length ? `<div class="related"><h3>Recent edits</h3><ul>${edits.map(c => `<li><a href="#/card/${c.id}">${esc(c.name)}</a> <span class="muted">${esc((c.edited || []).join(", "))}${c.editAt ? ` · ${esc(c.editAt.slice(0, 10))}` : ""}</span></li>`).join("")}</ul></div>` : ""}
    ${p.recent?.length ? `<div class="related"><h3>Recent card commits</h3><ul>${p.recent.map(([ts, subject, n]) => `<li>${esc(x.date(ts))} <span class="muted">· ${esc(subject)} · ${plural(n, "card")}</span></li>`).join("")}</ul></div>` : ""}`;
}

/** The Cards panel: the person's cards by kind (chips to the Cards tab), their biggest series, the newest card (from
 *  fs, the first upload; left out when the build had no history) and the newest cards.
 *  x = {cards, kinds ([[kind, label]], app.js KINDS), kindOf, month(ts), tile(card)} */
export function cardsPanelHtml(p, x) {
  const own = cardsOf(p.key, x.cards);
  if (!own.length) return "";
  const f = cardFacts(own, { kindOf: x.kindOf, kinds: x.kinds });
  const label = k => (x.kinds.find(([key]) => key === k) || [k, k])[1];
  const by = `author=${encodeURIComponent(p.key)}`;
  return `<div class="profile"><div class="panel"><h3>Cards <span class="muted">${own.length}</span></h3>
    <div class="chips">${f.kinds.map(([k, n]) => `<a class="chip" href="#/cards?${by}&kind=${encodeURIComponent(k)}">${esc(label(k))}<span class="n">${n}</span></a>`).join("")}</div>
    <div class="facts">
      ${f.series.length ? `<span class="fact">Mostly ${f.series.map(([s, n]) => `<a href="#/cards?${by}&series=${encodeURIComponent(s)}">${esc(s)}</a> <span class="muted">${n}</span>`).join(", ")}</span>` : ""}
      ${f.newest ? `<span class="fact" data-tip="First upload of the card image">Newest card: <a href="#/card/${f.newest.id}">${esc(f.newest.name)}</a> · ${esc(x.month(f.newest.fs))}</span>` : ""}
    </div>
    <div class="grid" style="--tile:120px">${f.recent.map(x.tile).join("")}</div>
    <p><a href="#/cards?${by}&sort=new">All ${plural(own.length, "card")}</a></p></div></div>`;
}

/** The person page: the profile (when there is one) over the contributions and the Cards panel; a contributor without
 *  a profile gets a plain header instead. x = profileHtml's x + cardsPanelHtml's x + {person | null, available, titles, date} */
export function personHtml(x) {
  const { person, profile } = x;
  if (!person) return profileHtml(x);
  if (profile || x.removed) return `${profileHtml(x)}<div class="profile"><div class="panel"><h3>Contributions</h3>${contributionsHtml(person, x)}</div></div>${cardsPanelHtml(person, x)}`;
  return `<div class="profile"><div class="panel"><h2>${esc(person.key)}</h2>${contributionsHtml(person, x)}
    <div class="actions">
      ${x.own ? `<button type="button" class="primary" data-action="profile-edit">Make your profile</button>` : ""}
      <button type="button" data-action="copy-user-link" data-login="${esc(person.key)}">Copy link</button>
      <a class="fact" href="#/users">All people</a>
    </div></div></div>${cardsPanelHtml(person, x)}`;
}

/** rows = peopleRows(...); x = {me, hasOwn, available, since, titles (Map), date(ts)} */
export function peopleHtml(rows, x) {
  const n = rows.length, link = r => (r.profile ? r.profile.login : r.key);
  const row = r => `<tr><td><a href="#/u/${encodeURIComponent(link(r))}">${esc(link(r))}</a>${r.person && link(r) !== r.key ? ` <span class="muted">${esc(r.key)}</span>` : ""} ${stateFact(r.state)}</td>
    <td class="num">${r.person?.cards || ""}</td><td class="num">${r.person?.edits || ""}</td><td class="num">${r.person?.commits || ""}</td>
    <td>${titleChips(r.key, x.titles)}</td><td class="muted">${esc(r.profile?.motto || "")}</td></tr>`;
  const scope = x.available ? (x.since ? ` · since ${esc(x.date(x.since))}` : "") : ` · <span class="muted" data-tip="This build has no git history, so card commits are missing and edits are counted from Card Edits.json">commits not in this build</span>`;
  return `<div class="profile">
    <div class="toolbar"><span class="result-count">${n} ${n === 1 ? "person" : "people"}${scope}</span>
      ${x.me ? (x.hasOwn ? "" : `<button type="button" class="primary" data-action="profile-edit">Make your profile</button>`) : `<span class="muted">Sign in (top right) to make your profile.</span>`}</div>
    ${n ? `<table class="data"><thead><tr><th>Person</th><th class="num">Cards</th><th class="num">Edits</th><th class="num">Card commits</th><th>Titles</th><th>Motto</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`
      : `<div class="empty">Nobody yet.</div>`}
    <p class="muted">Cards credited to each person · edits: commits to Card Edits.json (batches published on the website, or by hand) · card commits: commits that added or changed a card's PSD or PNG (moves and rulebook pages don't count). The top of each column holds its title.</p></div>`;
}
