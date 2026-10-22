// People: profiles (site/profiles/<login>.json, made on the website and published with the edit batch (edit.js), read by
// build_site.py into data/users.json) and contributions (data/contributions.json: cards credited, edit batches published
// and card commits per person, from build_site.py contributions()). Pure functions, plus the person page and the People
// table. All profile text is user-written: everything is escaped and only internal routes are linked.
import { esc } from "./text.js";
import { decode } from "./deck.js";
import { columns, chartCard } from "./stats.js";

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
/** A GitHub login's avatar and profile link, only ever from a login (never from profile text); "" for anything else. */
export const githubUrl = login => (LOGIN_RE.test(login || "") ? `https://github.com/${encodeURIComponent(login)}` : "");
export const avatarHtml = (login, px) => (LOGIN_RE.test(login || "")
  ? `<img class="avatar" src="https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${px * 2}" width="${px}" height="${px}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${esc(login)} on GitHub">` : "");
const githubFact = login => (githubUrl(login) ? `<a class="fact" href="${githubUrl(login)}" target="_blank" rel="noopener">GitHub: ${esc(login)}</a>` : "");
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
    <h2 class="person-name">${avatarHtml(p.login, 48)}${esc(p.login)}</h2>
    <div class="facts">
      ${githubFact(p.login)}
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
      <button type="button" data-action="share-user" data-login="${esc(p.login)}">Share</button>
      <a class="fact" href="#/users">All people</a>
    </div>`}</div></div>`;
}

// ---- contributions (data/contributions.json) ----------------------------------------------------------
// person = {key, logins[], github?, cards, edits, commits, first, last, recent[[ts, subject, nCards]], recentEdits[[ts, subject, sha]],
// months[["YYYY-MM", cards, edits, commits]]}; key = the name cards credit; github = a login known to be theirs (build_site.py contributions)
export const TITLES = [["cards", "Top card maker", "Most cards"], ["edits", "Top editor", "Most edits: commits to Card Edits.json, published on the website or by hand"],
  ["commits", "Top committer", "Most commits that added or changed a card (moves and rulebook pages don't count)"]];          // the top count per column; ties share; build_site.py TITLES
export const OVERALL = ["Top contributor", "Most contributions: cards, edits and card commits added together"];   // build_site.py OVERALL
const TITLE_TIP = Object.fromEntries([[OVERALL[0], OVERALL[1]], ...TITLES.map(([, title, tip]) => [title, tip])]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lc = s => String(s ?? "").toLowerCase();
const hasLogin = (person, login) => person.logins.some(l => lc(l) === lc(login));
/** Map key -> titles: OVERALL for the top total of TITLES' columns, then the top count in each column; ties share; nobody at 0. */
export function titlesOf(people) {
  const out = new Map(people.map(p => [p.key, []]));
  const sum = p => TITLES.reduce((n, [field]) => n + (p[field] || 0), 0), best = Math.max(0, ...people.map(sum));
  if (best) for (const p of people) if (sum(p) === best) out.get(p.key).push(OVERALL[0]);
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
const commitLink = (repo, sha, text) => (/^[0-9a-f]{40}$/.test(sha || "") && /^[\w.-]+\/[\w.-]+$/.test(repo || "")
  ? `<a href="https://github.com/${repo}/commit/${sha}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
const titleChips = (key, titles) => (titles.get(key) || []).map(t => `<span class="fact" data-tip="${esc(TITLE_TIP[t] || "")}">${esc(t)}</span>`).join(" ");

/** The contributions of one person: a facts row, their recent edits (cards.json editBy, the last batch per card), their
 *  recent edit batches (commits to Card Edits.json) and their recent card commits. x = {cards, available, titles (Map), date(ts), repo} */
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
    ${edits.length ? `<div class="related"><h3>Recently edited cards</h3><ul>${edits.map(c => `<li><a href="#/card/${c.id}">${esc(c.name)}</a> <span class="muted">${esc((c.edited || []).join(", "))}${c.editAt ? ` · ${esc(c.editAt.slice(0, 10))}` : ""}</span></li>`).join("")}</ul></div>` : ""}
    ${p.recentEdits?.length ? `<div class="related"><h3>Recent edit batches</h3><ul>${p.recentEdits.map(([ts, subject, sha]) => `<li>${commitLink(x.repo, sha, x.date(ts))} <span class="muted">· ${esc(subject)}</span></li>`).join("")}</ul></div>` : ""}
    ${p.recent?.length ? `<div class="related"><h3>Recent card commits</h3><ul>${p.recent.map(([ts, subject, n]) => `<li>${esc(x.date(ts))} <span class="muted">· ${esc(subject)} · ${plural(n, "card")}</span></li>`).join("")}</ul></div>` : ""}`;
}

/** The months from the first to the last of `months` (["YYYY-MM", ...] rows), every one, as [key, row | null]. */
export function monthRange(months) {
  const keys = (months || []).map(m => m[0]).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
  if (!keys.length) return [];
  const by = new Map(months.map(m => [m[0], m])), out = [];
  let [y, m] = keys[0].split("-").map(Number);
  const [y1, m1] = keys[keys.length - 1].split("-").map(Number);
  for (; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push([k, by.get(k) || null]);
  }
  return out;
}
export const ACTIVITY = [["cards", "Cards first uploaded", "var(--s1)", "cards"], ["edits", "Edit batches", "var(--s2)", "edits"], ["commits", "Card commits", "var(--s3)", "commits"]];
/** The person's activity chart: one row of monthly columns per kind they have (each on its own scale, so a big import
 *  month doesn't flatten the rest), on one month axis; Table shows the numbers. "" without months. */
export function activityHtml(p, x = {}) {
  const range = monthRange(p.months);
  const kinds = ACTIVITY.map((k, i) => [...k, i + 1]).filter(([, , , , i]) => range.some(([, r]) => r && r[i]));
  if (!kinds.length) return "";
  const label = k => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }); };
  const every = Math.max(1, Math.ceil(range.length / 9));
  const rows = kinds.map(([, name, color, unit, i]) => {
    const total = range.reduce((n, [, r]) => n + (r ? r[i] || 0 : 0), 0);
    return `<div><div class="legend" style="margin:6px 0 0"><span><i style="background:${color}"></i>${esc(name)} <span class="muted">${total}</span></span></div>
      ${columns(range.map(([k, r]) => ({ label: label(k), value: r ? r[i] || 0 : 0 })), { unit, color, every, height: 84, width: 940 })}</div>`;
  }).join("");
  const table = `<div class="table-wrap"><table class="data"><thead><tr><th>Month</th>${kinds.map(([, name]) => `<th class="num">${esc(name)}</th>`).join("")}</tr></thead>
    <tbody>${range.filter(([, r]) => r).map(([k, r]) => `<tr><td>${esc(label(k))}</td>${kinds.map(([, , , , i]) => `<td class="num">${r[i] || 0}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const sub = `Each row has its own scale. Cards count by their image's first upload${x.since && x.month ? `, so cards made before the history starts (${x.month(x.since)}) count in its first month` : ""}.`;
  return `<div class="profile">${chartCard("activity", "Contributions by month", sub, rows, table)}</div>`;
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
    <p><a href="#/cards?${by}&sort=created">All ${plural(own.length, "card")}</a></p></div></div>`;
}

/** The Decks panel: the person's public decks (decks.js entries, newest first) as the deck browser's tiles, and their
 *  private ones as locked links (the only place a private deck is listed; the browser leaves them out). x = {decks: {public: [],
 *  private: []}, deckTile(entry)}; nothing when they have none. */
export function decksPanelHtml(x) {
  const pub = Array.isArray(x.decks?.public) ? x.decks.public : [], priv = Array.isArray(x.decks?.private) ? x.decks.private : [];
  if (!pub.length && !priv.length) return "";
  const link = d => `<a href="#/decks/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.slug)}">${esc(d.slug)}</a>`;
  return `<div class="profile"><div class="panel"><h3>Decks <span class="muted">${pub.length + priv.length}</span></h3>
    ${pub.length ? `<div class="deck-grid">${pub.map(x.deckTile).join("")}</div>` : ""}
    ${priv.length ? `<p class="muted">🔒 ${plural(priv.length, "private deck")}: ${priv.map(link).join(", ")}</p>` : ""}
    ${pub.length ? `<p><a href="#/decks?owner=${encodeURIComponent(pub[0].owner)}">All decks by ${esc(pub[0].owner)}</a></p>` : ""}</div></div>`;
}

/** The person page: the profile (when there is one) over the contributions, the activity chart, the Cards panel and the
 *  Decks panel; a contributor without a profile gets a plain header instead. x = profileHtml's x + cardsPanelHtml's x +
 *  decksPanelHtml's x + {person | null, available, since, titles, date, month, repo} */
export function personHtml(x) {
  const { person, profile } = x;
  if (!person) return `${profileHtml(x)}${decksPanelHtml(x)}`;
  const rest = `${x.available ? activityHtml(person, x) : ""}${cardsPanelHtml(person, x)}${decksPanelHtml(x)}`;
  if (profile || x.removed) return `${profileHtml(x)}<div class="profile"><div class="panel"><h3>Contributions</h3>${contributionsHtml(person, x)}</div></div>${rest}`;
  return `<div class="profile"><div class="panel"><h2 class="person-name">${avatarHtml(person.github, 48)}${esc(person.key)}</h2>
    ${person.github ? `<div class="facts">${githubFact(person.github)}</div>` : ""}${contributionsHtml(person, x)}
    <div class="actions">
      ${x.own ? `<button type="button" class="primary" data-action="profile-edit">Make your profile</button>` : ""}
      <button type="button" data-action="share-user" data-login="${esc(person.key)}">Share</button>
      <a class="fact" href="#/users">All people</a>
    </div></div></div>${rest}`;
}

/** The login a row's avatar and GitHub link use: the profile's, else the one the build knows for the person. */
export const githubOf = r => (r.profile ? r.profile.login : r.person?.github || "");
/** A row's public decks: owner (any case) is the profile's login, one of the person's logins or their GitHub login. */
export function deckCount(r, decks) {
  const owners = new Set([r.profile?.login, r.person?.github, ...(r.person?.logins || [])].filter(Boolean).map(lc));
  return decks.filter(d => !d.private && owners.has(lc(d.owner))).length;
}

/** rows = peopleRows(...); x = {me, hasOwn, available, since, titles (Map), date(ts), decks (decks.js entries; public ones count)} */
export function peopleHtml(rows, x) {
  const n = rows.length, link = r => (r.profile ? r.profile.login : r.key), decks = x.decks || [];
  const face = r => { const gh = githubOf(r); return gh && githubUrl(gh) ? `<a class="face" href="${githubUrl(gh)}" target="_blank" rel="noopener" title="${esc(gh)} on GitHub">${avatarHtml(gh, 20)}</a>` : `<span class="face"></span>`; };
  const row = r => `<tr><td>${face(r)}<a href="#/u/${encodeURIComponent(link(r))}">${esc(link(r))}</a>${r.person && link(r) !== r.key ? ` <span class="muted">${esc(r.key)}</span>` : ""} ${stateFact(r.state)}</td>
    <td class="num">${r.person?.cards || ""}</td><td class="num">${r.person?.edits || ""}</td><td class="num">${r.person?.commits || ""}</td><td class="num">${deckCount(r, decks) || ""}</td>
    <td>${titleChips(r.key, x.titles)}</td><td class="muted">${esc(r.profile?.motto || "")}</td></tr>`;
  const scope = x.available ? (x.since ? ` · since ${esc(x.date(x.since))}` : "") : ` · <span class="muted" data-tip="This build has no git history, so card commits are missing and edits are counted from Card Edits.json">commits not in this build</span>`;
  return `<div class="profile">
    <div class="toolbar"><span class="result-count">${n} ${n === 1 ? "person" : "people"}${scope}</span>
      ${x.me ? (x.hasOwn ? "" : `<button type="button" class="primary" data-action="profile-edit">Make your profile</button>`) : `<span class="muted">Sign in (top right) to make your profile.</span>`}</div>
    ${n ? `<div class="scroll-x"><table class="data people"><thead><tr><th>Person</th><th class="num">Cards</th><th class="num">Edits</th><th class="num">Card commits</th><th class="num">Decks</th><th>Titles</th><th>Motto</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>`
      : `<div class="empty">Nobody yet.</div>`}
    <p class="muted">Cards credited to each person · edits: commits to Card Edits.json (batches published on the website, or by hand) · card commits: commits that added or changed a card's PSD or PNG (moves and rulebook pages don't count; a card the bot reprinted for an edit counts for the editor) · decks: public decks they published. The top of each column holds its title; the top of the three added together is the Top contributor.</p></div>`;
}

// ---- sharing a person (the u/<name>/ page's link preview, from the build) -------------------------------------
const md = s => String(s).replace(/([\\*_~`|[\]])/g, "\\$1");
const KIND_WORDS = { creature: "creatures", item: "items", field: "field cards", minion: "minions", nme: "N.M.E. items", "aux item": "auxiliary items",
  status: "status effects", creatures: "auxiliary creatures" };          // build_site.py KIND_PLURAL
const kindWord = (k, n) => { const w = KIND_WORDS[k] || k; return n === 1 ? w.replace(/s$/, "") : w; };
/** "Top card maker · 237 cards · 4 edits · 57 card commits" (build_site.py contrib_text). */
export function contribLine(p, titles) {
  return [...(titles.get(p.key) || []), p.cards ? plural(p.cards, "card") : "", p.edits ? plural(p.edits, "edit") : "", p.commits ? plural(p.commits, "card commit") : ""].filter(Boolean).join(" · ");
}
/** "120 items, 53 creatures, 32 field cards · mostly Hollow Knight, …" (build_site.py cards_text). */
export function cardsLine(author, cards, kindOf = c => c.type) {
  const own = cardsOf(author, cards);
  if (!own.length) return "";
  const f = cardFacts(own, { kindOf, kinds: Object.keys(KIND_WORDS).map(k => [k]) });
  return `${f.kinds.slice(0, 3).map(([k, n]) => `${n} ${kindWord(k, n)}`).join(", ")}${f.series.length ? ` · mostly ${f.series.map(([s]) => s).join(", ")}` : ""}`;
}
/** The Discord message: the name as a link (no preview), titles and counts, the cards line; no profile text, so it carries
 *  no link but the page's. x = {name, url, person | null, titles, cards, kindOf} */
export function personDiscord(x) {
  const p = x.person;
  return [[`**[${md(x.name)}](<${x.url}>)**`, p ? md(contribLine(p, x.titles)) : ""].filter(Boolean).join(" · "), p ? md(cardsLine(p.key, x.cards, x.kindOf)) : ""].filter(Boolean).join("\n");
}
/** Plain text: the name, titles and counts, the cards line; no profile text either. x = personDiscord's x, without url */
export function personText(x) {
  const p = x.person;
  return [[x.name, p ? contribLine(p, x.titles) : ""].filter(Boolean).join(" · "), p ? cardsLine(p.key, x.cards, x.kindOf) : ""].filter(Boolean).join("\n");
}
/** The share dialog. x = {name, url, text (the page's preview text), image, color, state, native (navigator.share exists)} */
export function shareDialogHtml(x) {
  const login = esc(x.name);
  return `<h3>Share ${login}</h3>
    <div class="share-url"><input id="share-url" readonly value="${esc(x.url)}" aria-label="Profile link"><button type="button" class="primary" data-action="copy-user-link" data-login="${login}">Copy link</button></div>
    <p class="muted">Paste the link in Discord for a preview like this${x.state ? " (the published page: your unpublished or just-published changes show after the site rebuilds)" : ""}:</p>
    <div class="embed" style="--c:${/^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : "#3987e5"}"><div class="embed-site">Impossibility Simulator</div><div class="embed-title">${login}</div>
      <div class="embed-desc">${esc(x.text || "").replace(/\n/g, "<br>")}</div>${x.image ? `<img src="${esc(x.image)}" alt="">` : ""}</div>
    <div class="actions">
      <button type="button" data-action="share-user-discord" data-login="${login}" title="Name as a link, titles and counts, without a preview">Copy as Discord message</button>
      <button type="button" data-action="share-user-text" data-login="${login}" title="Name, titles and counts">Copy plain text</button>
      ${x.native ? `<button type="button" data-action="share-user-native" data-login="${login}">Share…</button>` : ""}
    </div>`;
}
