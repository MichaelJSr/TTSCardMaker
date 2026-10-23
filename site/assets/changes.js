// The Changes page's Changelog and Database edits tabs (app.js renderChanges has the tab row and the other tabs), from
// data/changelog.json (build_site.py: the card sync's events, the edit batches from git history, the archived cards).
// Events are grouped by push as the Discord posts are
// (AutoCroissant commands/changelog.py: messages(), title_of(), link_of(), SECTIONS). DOM-free: every function returns
// HTML, every string goes through esc.
import { esc, diffWords } from "./text.js";

const TZ = "America/Los_Angeles";                         // the bot's TIMEZONE: the posts' times, balance.js
const CARD_SYNC = "Card sync";                            // the push of the run's own commit (changelog.CARD_SYNC)
const BAKED = "Website edits baked into the PSDs";
const KIND_LABEL = { creature: "Creature", item: "Item", field: "Field card", minion: "Minion", nme: "N.M.E. item", "aux item": "Auxiliary item",
  debuff: "Debuff", buff: "Buff", creatures: "Auxiliary creature", unknown: "Other" };   // app.js KIND_LABEL
// the post's sections, in its order; re-reads close the post with one line (here: a list under it)
export const SECTIONS = [[["new"], "New cards"], [["changed"], "Changed"], [["art"], "New art"], [["moved", "renamed"], "Moved and renamed"],
  [["archived"], "Archived"], [["restored"], "Restored"], [["edited", "authors"], "Database edits"], [["restore"], "Rollback"]];
const COUNT_WORDS = [["new", "new"], ["changed", "changed"], ["art", "new art"], ["moved", "moved"], ["renamed", "renamed"], ["archived", "archived"],
  ["restored", "restored"], ["edited", "edited"], ["authors", "edited"], ["reparse", "re-read"], ["restore", "data rollback"]];
// the kind filter: [kind, chip label]
export const KINDS = [["new", "New"], ["changed", "Changed"], ["art", "New art"], ["moved", "Moved"], ["renamed", "Renamed"], ["archived", "Archived"],
  ["restored", "Restored"], ["edited", "Edited"], ["authors", "Authors"], ["reparse", "Re-read"], ["restore", "Rollback"]];
export const EDIT_KINDS = ["edited", "authors"];
const VIA = { website: "on the website", discord: "via Discord", git: "by commit" };
const FIELD = { hp: "HP", def: "DEF", atk: "ATK", spd: "SPD", stars: "stars", name: "title", card_type: "kind", type: "kind", subtype: "item type",
  dup_of: "duplicate of", problems_ok: "parser notes checked", allow_high_stats: "high stats allowed" };

const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const partsOf = ts => Object.fromEntries(parts.formatToParts(new Date((ts || 0) * 1000)).map(x => [x.type, x.value]));
/** "Oct 22 14:05" in Pacific time, as the posts' titles */
export const when = ts => { const p = partsOf(ts); return `${p.month} ${p.day} ${p.hour}:${p.minute}`; };
const dayKey = ts => { const p = partsOf(ts); return `${p.year} ${p.month} ${p.day}`; };
const dayLabel = ts => new Date((ts || 0) * 1000).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: TZ });
const dateLabel = ts => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: TZ }) : "");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const short = sha => esc(String(sha || "").slice(0, 8));

/** The posts' groups: events in seq order, consecutive ones with one build, push and re-read flag together (messages()). */
export function pushGroups(events) {
  const out = [];
  let last = null;
  for (const e of [...(events || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    const key = JSON.stringify([e.build ?? null, e.push?.after ?? null, e.kind === "reparse"]);
    if (key !== last) out.push([]);
    out[out.length - 1].push(e);
    last = key;
  }
  return out;
}
/** [who, when] of a group: the push's, else the card sync's at its build (title_of()) */
function whoOf(group) {
  const push = group[0].push;
  if (!push) return [CARD_SYNC, group[0].at];
  return [push.by === CARD_SYNC ? BAKED : push.by || "Someone", push.at ?? group[0].at];
}
/** "1 new, 2 changed" */
export function countsOf(group) {
  const counts = new Map();
  for (const [kind, word] of COUNT_WORDS) { const n = group.filter(e => e.kind === kind).length; if (n) counts.set(word, (counts.get(word) || 0) + n); }
  return [...counts].map(([word, n]) => `${n} ${word}`).join(", ");
}
/** "Zomoroko, Oct 22 14:05: 1 new, 2 changed": the post's title */
export function titleOf(group) { const [who, at] = whoOf(group); return `${who}, ${when(at)}: ${countsOf(group)}`; }
/** The push's compare view (before...after), its commit without a before, else the build's run (link_of()) */
export function linkOf(group, repo) {
  const push = group[0].push;
  if (push && repo) {
    const before = push.before || "", after = push.after;
    return before.replace(/0/g, "") ? `https://github.com/${repo}/compare/${before.slice(0, 12)}...${after.slice(0, 12)}` : `https://github.com/${repo}/commit/${after}`;
  }
  const build = String(group[0].build || "");
  return build.startsWith("http") ? build : "";
}

// ---- one event --------------------------------------------------------------------------------------------------
const kindWord = t => KIND_LABEL[t] || t || KIND_LABEL.unknown;
const cardLink = (id, text) => (id ? `<a href="#/card/${encodeURIComponent(id)}">${esc(text)}</a>` : `<b>${esc(text)}</b>`);
const value = v => (v == null || v === "" || (Array.isArray(v) && !v.length) ? "none" : Array.isArray(v) ? v.map(x => (x && typeof x === "object" ? JSON.stringify(x) : x)).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const isLogin = s => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(s || "");
export const BOT = "AutoCroissant";                       // the bot's _by (build_site.BOT_AUTHOR): nobody's edit
const isBot = name => String(name || "").toLowerCase() === BOT.toLowerCase();
/** The fields of a card's Card Edits.json entry its editor (editBy) changed: none in the bot's own entries, and not the
    fields in the entry's _bot (botEdited: the migration's, or a Discord editor's in fieldBy) */
export const editorFields = c => (!c?.edited || isBot(c.editBy) ? [] : c.edited.filter(f => !(c.botEdited || []).includes(f)));
/** A card's edits by editor, [{by, at, fields}]: the entry's editor (editorFields), then each Discord editor of its _bot
    fields (fieldBy {field: [by, at]}, the entry's _credit; their latest at); never the bot */
export function fieldEditors(c) {
  const out = [], mine = editorFields(c);
  if (mine.length) out.push({ by: c.editBy || "", at: c.editAt || "", fields: mine });
  const credited = new Map();
  for (const [f, stamp] of Object.entries(c?.fieldBy || {})) {
    const [by, at] = Array.isArray(stamp) ? stamp : [];
    if (!by || isBot(by) || !(c.edited || []).includes(f)) continue;
    const row = credited.get(by.toLowerCase()) || { by, at: "", fields: [] };
    row.fields.push(f);
    if (String(at || "") > row.at) row.at = String(at);
    credited.set(by.toLowerCase(), row);
  }
  return [...out, ...credited.values()];
}
/** The Edited badge's tooltip: each editor's fields, name and day */
export function editedTip(c) {
  const rows = fieldEditors(c);
  const line = r => `${r.fields.join(", ")}${r.by ? ` · ${nameText(r.by)}` : ""}${r.at ? ` · ${r.at.slice(0, 10)}` : ""}`;
  return `${rows.some(r => isDiscord(r.by)) ? "Changed" : "Changed on the website"}: ${rows.map(line).join("; ")}`;
}
/** The Website edits tab's rows, one per card and editor (fieldEditors: {c, by, at, fields}), newest first, at most
    WEB_EDITS_SHOWN; total: how many there are */
export const WEB_EDITS_SHOWN = 100;
export function webEdits(all) {
  const list = all.flatMap(c => fieldEditors(c).map(r => ({ c, ...r }))).sort((a, b) => b.at.localeCompare(a.at));
  return { shown: list.slice(0, WEB_EDITS_SHOWN), total: list.length };
}
/** Does the chosen tab take the focus after a redraw? Only when a tab had it from the keyboard (:focus-visible): a
    mouse click hands it none, so no focus ring */
export function keepsTabFocus(el) {
  if (!el?.closest?.(".change-tabs")) return false;
  try { return el.matches(":focus-visible"); } catch { return true; }   // a browser without :focus-visible: as before
}
const personLink = name => (isLogin(name) && !isBot(name) ? `<a href="#/u/${encodeURIComponent(name)}">${esc(name)}</a>` : esc(name));
/** A discord:<name> stamp or Edit-by: a Discord user, never a website login */
export const isDiscord = name => String(name || "").toLowerCase().startsWith("discord:");
/** An editor as plain text: a Discord user "<name> (via Discord)", anything else as written */
export const nameText = name => (isDiscord(name) ? `${name.slice(8)} (via Discord)` : String(name || ""));
/** A name as written, or a person page link; a Discord user is "<name> (via Discord)", never a person page */
export const nameHtml = name => (isDiscord(name) ? esc(nameText(name)) : personLink(name));
/** "(by X, on the website)" / "(by X, via Discord)" / "(by AutoCroissant)" from an edit's _by */
function byWhom(by) {
  if (!by) return "";
  // the bot's own entries (the alias migration's _by) came from neither
  return ` <span class="muted">(by ${isDiscord(by) ? `${esc(by.slice(8))}, via Discord` : isBot(by) ? esc(by) : `${personLink(by)}, on the website`})</span>`;
}
/** One field change: "HP 5 → 6", "series Mario → Kirby"; the ability as a word diff below the line */
function fieldHtml(key, [a, b]) {
  if (key === "ability" || key === "tags") return "";
  if (key === "creatures") return "creature stats changed";
  if (key === "hidden") return b ? "hidden" : "shown again";
  if (typeof b === "boolean" && FIELD[key]) return b ? FIELD[key] : `${FIELD[key]}: off`;
  return `${esc(FIELD[key] || key.replace(/_/g, " "))} ${esc(value(a))} → ${esc(value(b))}`;
}
/** A field list's line and the ability diff */
export function fieldsHtml(fields) {
  const f = fields || {};
  const line = [...Object.entries(f).map(([k, v]) => (Array.isArray(v) && v.length === 2 ? fieldHtml(k, v) : "")).filter(Boolean),
    ...(f.ability ? ["ability changed"] : [])].join("; ");
  const diff = Array.isArray(f.ability) && f.ability.length === 2 ? `<div class="ability cl-diff">${diffWords(f.ability[0], f.ability[1])}</div>` : "";
  return { line, diff };
}
const VERDICT = { buff: ["diff-up", "buff"], nerf: ["diff-down", "nerf"], mixed: ["muted", "buffs and nerfs"] };
const verdictHtml = e => { const v = VERDICT[e.verdict]; const why = [...(e.buffs || []), ...(e.nerfs || [])].join("; "); return v ? ` <span class="${v[0]}"${why ? ` data-tip="${esc(why)}"` : ""}>(${v[1]})</span>` : ""; };
const folder = p => String(p || "").split("/").slice(0, -1).join("/");
/** Where an archived card's PSD went: "moved to MDW/The Morgue" (moved_to: retired, not deleted), else "PSD deleted" */
const goneText = e => (e.moved_to ? `moved to ${folder(e.moved_to) || e.moved_to}` : "PSD deleted");
/** One event as a line (the post's _line(), with the old values and the ability diff) */
export function eventHtml(e) {
  const title = cardLink(e.id, e.title || e.card);
  switch (e.kind) {
    case "restore": return `<li>Card data restored from ${short(e.restored_from || "?")}</li>`;
    case "new": return `<li>${title} <span class="muted">(${esc(kindWord(e.card_type))}${e.stars ? `, ${e.stars}★` : ""})</span>${e.by ? ` by ${esc(e.by)}` : ""}</li>`;
    case "renamed": return `<li>${esc(e.title || e.card)} is now ${cardLink(e.renamedId, e.renamed_to || "?")}</li>`;
    case "moved": return `<li>${title} moved to ${esc(folder(e.path) || "?")}${e.from_path ? ` <span class="muted">from ${esc(folder(e.from_path))}</span>` : ""}</li>`;
    case "archived": return `<li>${esc(e.title || e.card)} <span class="muted">(${esc(goneText(e))})</span></li>`;
    case "restored": return `<li>${title} <span class="muted">(PSD back)</span></li>`;
    case "art": return `<li>${title}</li>`;
    default: {                                            // changed, edited, authors, reparse
      const { line, diff } = fieldsHtml(e.fields);
      return `<li>${title}${line ? `: ${line}` : ""}${verdictHtml(e)}${e.kind === "edited" ? byWhom(e.edit_by) : ""}${diff}</li>`;
    }
  }
}

// ---- one push ---------------------------------------------------------------------------------------------------
/** A push's block: the post's title linked to the push, its sections, then the re-reads. kinds: only those (a filter) */
export function groupHtml(group, repo, kinds = null) {
  const shown = kinds ? group.filter(e => kinds.includes(e.kind)) : group;
  if (!shown.length) return "";
  const [who, at] = whoOf(group), link = linkOf(group, repo);
  const head = `${esc(who)}, ${esc(when(at))}`;
  const secs = SECTIONS.map(([ks, heading]) => {
    const lines = shown.filter(e => ks.includes(e.kind));
    return lines.length ? `<div class="cl-sec"><h4>${esc(heading)}</h4><ul class="cl-lines">${lines.map(eventHtml).join("")}</ul></div>` : "";
  }).join("");
  const rereads = shown.filter(e => e.kind === "reparse");
  const tail = rereads.length ? `<details class="cl-sec"><summary>The parser re-read ${plural(rereads.length, "card")}</summary><ul class="cl-lines">${rereads.map(eventHtml).join("")}</ul></details>` : "";
  return `<section class="panel cl-push"><h3>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${head}</a>` : head}<span class="muted">: ${esc(countsOf(group))}</span></h3>${secs}${tail}</section>`;
}
/** Groups under a heading per day (Pacific), newest first by time (a push split across builds, or one older than the
    last build's, keeps one heading per day), then by seq */
function daysHtml(groups, repo, kinds) {
  let day = "", out = "";
  const byTime = [...groups].reverse().map((g, i) => [g, whoOf(g)[1] || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  for (const [g] of byTime) {
    const html = groupHtml(g, repo, kinds);
    if (!html) continue;
    const at = whoOf(g)[1], key = dayKey(at);
    if (key !== day) { out += `<h3 class="cl-day">${esc(dayLabel(at))}</h3>`; day = key; }
    out += html;
  }
  return out;
}
const chips = (options, selected, counts, key) => `<div class="chips">${options.map(([v, label]) => `<button type="button" class="chip${selected.includes(v) ? " on" : ""}" data-action="toggle-param" data-key="${key}" data-value="${esc(v)}">${esc(label)}<span class="n">${counts.get(v) || 0}</span></button>`).join("")}</div>`;
const csv = (p, k) => (p?.get(k) ? p.get(k).split(",").filter(Boolean) : []);
/** "Card data built … from TTSCardMaker@abc12345 (run)" */
function sourceHtml(C) {
  const s = C.source;
  if (!s) return "";
  const at = s.built_at ? new Date(s.built_at).toLocaleString(undefined, { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "";
  const commit = s.card_commit ? ` from <a href="https://github.com/${esc(C.repo)}/commit/${esc(s.card_commit)}" target="_blank" rel="noopener">${esc(C.repo.split("/").pop())}@${short(s.card_commit)}</a>` : "";
  return `<p class="muted">Card data built ${esc(at)} (Pacific)${commit}${s.run ? ` (<a href="${esc(s.run)}" target="_blank" rel="noopener">run</a>)` : ""}.</p>`;
}
const NOT_YET = "Once the card sync is running (every 30 minutes), it will record each card change here and post it in Discord, one post per push. Until then this tab has no events.";

// ---- the tabs ---------------------------------------------------------------------------------------------------
/** The Changelog tab: the events of the last C.days days by day and push, a kind filter (?kind=), and the archived cards */
export function changelogHtml(C, params) {
  const events = C?.events || [], kinds = csv(params, "kind").filter(k => KINDS.some(([x]) => x === k));
  const counts = new Map();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
  const present = KINDS.filter(([k]) => counts.get(k));
  const body = !C?.available ? `<p class="empty">No changelog yet. ${esc(NOT_YET)}</p>`
    : !events.length ? `<p class="empty">No card changes in the last ${esc(C.days)} days.</p>`
    : daysHtml(pushGroups(events), C.repo, kinds.length ? kinds : null) || `<p class="empty">No ${esc(kinds.join(", "))} changes in the last ${esc(C.days)} days.</p>`;
  return `<section class="panel"><h3>Changelog${events.length ? ` <span class="muted">${events.length}</span>` : ""}</h3>
    <p class="muted">Every card change the card sync recorded in the last ${esc(C?.days || 180)} days, one block per push, as posted in Discord. Times are Pacific.</p>
    ${sourceHtml(C || {})}${present.length > 1 ? chips(present, kinds, counts, "kind") : ""}</section>
    ${body}${archivedHtml(C?.archived || [], C?.repo)}`;
}
/** Archived cards: their PSD left the card folders (the bot's tags): deleted, renamed (renamed_to) or moved into MDW
    (moved_to) */
export function archivedHtml(rows, repo) {
  if (!rows.length) return "";
  const gone = r => (r.renamed_to ? ` · renamed to ${cardLink(r.renamedId, r.renamed_to)}` : ` · ${esc(goneText(r))}`);
  const line = r => `<li>${esc(r.title || r.card)} <span class="muted">${esc(kindWord(r.card_type))}${r.stars ? ` · ${r.stars}★` : ""}${r.at ? ` · ${esc(dateLabel(r.at))}` : ""}${r.path ? ` · ${esc(r.path)}` : ""}</span>${gone(r)}${r.commit && repo ? ` · <a href="https://github.com/${esc(repo)}/commit/${esc(r.commit)}" target="_blank" rel="noopener">${short(r.commit)}</a>` : ""}</li>`;
  return `<section class="panel"><h3>Archived cards <span class="muted">${rows.length}</span></h3><p class="muted">Cards whose PSD left the card folders: deleted, renamed, or moved to MDW (retired). The bot keeps their last version.</p><ul class="cl-lines">${rows.map(line).join("")}</ul></section>`;
}
/** One edit batch: who, when, where, its commit, and each card's fields old → new */
export function batchHtml(b, repo) {
  // per name: build_site keeps a Discord name's discord: prefix; a Discord batch's line already says "via Discord"
  const who = (b.by || []).map(n => (b.via === "discord" && isDiscord(n) ? esc(n.slice(8)) : nameHtml(n))).join(", ") || "Someone";
  const subject = b.subject && b.subject.length > 90 ? `${b.subject.slice(0, 89)}…` : b.subject;
  const commit = b.sha && repo ? ` · <a href="https://github.com/${esc(repo)}/commit/${esc(b.sha)}" target="_blank" rel="noopener" title="${esc(b.subject || "")}">${esc(subject || short(b.sha))}</a>` : "";
  const cards = (b.cards || []).map(c => { const { line, diff } = fieldsHtml(c.fields); return `<li>${cardLink(c.id, c.name || c.key)}${line ? `: ${line}` : ""}${diff}</li>`; });
  const authors = (b.authors || []).map(a => `<li>${cardLink(a.id, a.name || a.key)}: author ${esc(value(a.from))} → ${esc(value(a.to))}</li>`);
  const people = (b.people || []).map(([git, from, to]) => `<li><span class="muted">People:</span> ${esc(git)} ${to ? `shown as ${esc(to)}` : "removed"}${from && to ? ` <span class="muted">(was ${esc(from)})</span>` : ""}</li>`);
  const n = cards.length + authors.length + people.length + (b.more || 0);
  return `<section class="panel cl-push"><h3>${who}, ${esc(when(b.at))}<span class="muted">: ${plural(n, "change")} ${esc(VIA[b.via] || "")}${commit}</span></h3>
    ${b.stamped ? `<p class="muted">From the edit stamps (this build has no git history): each card's last edit only, its new values.</p>` : ""}
    <ul class="cl-lines">${[...cards, ...authors, ...people].join("")}${b.more ? `<li class="muted">and ${esc(b.more)} more${b.sha && repo ? ` in the <a href="https://github.com/${esc(repo)}/commit/${esc(b.sha)}" target="_blank" rel="noopener">commit</a>` : ""}</li>` : ""}</ul></section>`;
}
/** The Database edits tab: the card sync's edited and authors events by push, and the edit batches (?via=); the cards
    edited now are app.js's Website edits tab */
export function editsHtml(C, params) {
  const events = (C?.events || []).filter(e => EDIT_KINDS.includes(e.kind));
  const batches = C?.edits?.batches || [], via = csv(params, "via").filter(v => VIA[v]);
  const counts = new Map();
  for (const b of batches) counts.set(b.via, (counts.get(b.via) || 0) + 1);
  const present = Object.keys(VIA).filter(v => counts.get(v)).map(v => [v, { website: "Website", discord: "Discord", git: "Commits" }[v]]);
  const shownBatches = via.length ? batches.filter(b => via.includes(b.via)) : batches;
  const applied = !C?.available ? `<p class="muted">${esc(NOT_YET)}</p>`
    : events.length ? daysHtml(pushGroups(events), C.repo, EDIT_KINDS) : `<p class="muted">No database edits in the last ${esc(C.days)} days.</p>`;
  return `<section class="panel"><h3>Database edits</h3>
    <p class="muted">Edits to the card data that don't come from a PSD: the website's Edit button, Discord's /update_metadata and /alias, and commits to Card Edits.json or Card Authors.txt. Times are Pacific.</p></section>
    <h3 class="cl-day">Applied by the card sync${events.length ? ` <span class="muted">${events.length}</span>` : ""}</h3>${applied}
    <h3 class="cl-day">Edit batches${batches.length ? ` <span class="muted">${batches.length}</span>` : ""}</h3>
    ${present.length > 1 ? chips(present, via, counts, "via") : ""}
    ${shownBatches.length ? shownBatches.map(b => batchHtml(b, C.repo)).join("") : `<p class="muted">No edit batches in the last ${esc(C?.days || 180)} days.</p>`}`;
}
