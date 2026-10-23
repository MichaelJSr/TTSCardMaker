// Password sign-in: the GitHub token encrypted with its owner's password, published as site/logins/<login>.json so any
// device signs in with login + password; and this browser's sign-in kept encrypted under a device key that can't leave
// IndexedDB (never the token in plain text). DOM-free at import: edit.js wires the forms built here.
import { esc } from "./text.js";
import { LOGIN_RE } from "./profile.js";
import { b64, unb64 } from "./decks.js";

export const KDF = "PBKDF2-SHA-256";
export const ITER = 2_000_000;                    // ~0.2 s on an M2 Ultra (Chrome), about 1 s on a mid phone; the file is public
export const MIN_ITER = 1_000_000, MAX_ITER = 5_000_000;      // a file outside is refused: too weak, or would hang the page
export const LIMITS = { file: 4 * 1024, ct: 1024, salt: 16, iv: 12, tag: 16, min: 12, words: 4, max: 1024 };
export const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const FIELDS = ["v", "login", "kdf", "iterations", "salt", "iv", "ct", "at"];
const utf8 = s => new TextEncoder().encode(s);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
/** Binds the ciphertext to its login (any case), so a file copied under another name doesn't open. */
export const aadOf = login => `login:${String(login ?? "").toLowerCase()}`;
const pass = p => utf8(String(p ?? "").normalize("NFC"));       // the same bytes on every device

// ---- the published file ----------------------------------------------------------------------------
async function deriveKey(subtle, password, salt, iterations, uses) {
  const raw = await subtle.importKey("raw", pass(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, raw, { name: "AES-GCM", length: 256 }, false, uses);
}
/** The file object for site/logins/<login>.json (without `at`, which publishing stamps). */
export async function seal(subtle, password, login, token, { iterations = ITER, random = a => globalThis.crypto.getRandomValues(a) } = {}) {
  const salt = random(new Uint8Array(LIMITS.salt)), iv = random(new Uint8Array(LIMITS.iv));
  const key = await deriveKey(subtle, password, salt, iterations, ["encrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aadOf(login)) }, key, utf8(token));
  return { v: 1, login, kdf: KDF, iterations, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
/** The token in a checked file (checkFile), for login; throws "Wrong password" (also for a file copied or altered). */
export async function unseal(subtle, password, login, file) {
  const key = await deriveKey(subtle, password, unb64(file.salt), file.iterations, ["decrypt"]);
  let plain;
  try { plain = await subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv), additionalData: utf8(aadOf(login)) }, key, unb64(file.ct)); }
  catch { throw Object.assign(new Error("Wrong password"), { code: "wrong" }); }
  return new TextDecoder().decode(plain);
}
/** Standard base64 -> bytes, or null (size: exact byte count). */
export function bytesOf(v, size = null) {
  if (typeof v !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  let out; try { out = unb64(v.replace(/=+$/, "")); } catch { return null; }      // atob: padding optional
  return size == null || out.length === size ? out : null;
}
/** A login file's JSON, checked like build_site.py clean_login: {file, notes} (file null when unusable). stem: the file
 *  name's login; it must equal `login` (case: exactly when exact, else any case). */
export function checkFile(raw, stem, { exact = true } = {}) {
  const f = obj(raw);
  if (!f) return { file: null, notes: ["not a JSON object"] };
  if (f.v !== 1) return { file: null, notes: ['"v" must be 1'] };
  if (typeof f.login !== "string" || !LOGIN_RE.test(f.login)) return { file: null, notes: ['"login" must be a GitHub login'] };
  if (exact ? f.login !== stem : f.login.toLowerCase() !== String(stem).toLowerCase()) return { file: null, notes: [`login ${f.login} doesn't match the file name ${stem}`] };
  if (f.kdf !== KDF) return { file: null, notes: [`"kdf" must be ${KDF}`] };
  if (!Number.isInteger(f.iterations) || f.iterations < MIN_ITER || f.iterations > MAX_ITER) return { file: null, notes: [`"iterations" must be ${MIN_ITER} to ${MAX_ITER}`] };
  if (!bytesOf(f.salt, LIMITS.salt)) return { file: null, notes: [`"salt" must be ${LIMITS.salt} bytes in base64`] };
  if (!bytesOf(f.iv, LIMITS.iv)) return { file: null, notes: [`"iv" must be ${LIMITS.iv} bytes in base64`] };
  const ct = bytesOf(f.ct);
  if (!ct || ct.length <= LIMITS.tag || ct.length > LIMITS.ct) return { file: null, notes: [`"ct" must be AES-GCM ciphertext in base64 (at most ${LIMITS.ct} bytes)`] };
  const notes = [], file = Object.fromEntries(FIELDS.filter(k => k !== "at").map(k => [k, f[k]]));
  if (f.at !== undefined && !(typeof f.at === "string" && DATE_RE.test(f.at))) notes.push(`"at" isn't a date like 2026-10-23T01:45:00Z, ignored`);
  else if (f.at) file.at = f.at;
  const unknown = Object.keys(f).filter(k => !FIELDS.includes(k));
  if (unknown.length) notes.push(`unknown fields ignored: ${unknown.join(", ")}`);
  return { file, notes };
}
/** The file's text: keys sorted, 2-space indent, trailing newline (as the profiles and decks). */
export const fileText = file => `${JSON.stringify(sortKeys(file), null, 2)}\n`;

// ---- password strength -------------------------------------------------------------------------------
// first guesses, lowercase with leetspeak undone; a password made of one (repeated, or with digits and symbols around) is refused
const COMMON = new Set(`password passwd passcode qwerty qwertz azerty qwertyuiop asdf asdfgh asdfghjkl zxcvbnm iloveyou loveyou
letmein welcome admin administrator root user login secret changeme default monkey dragon football baseball basketball soccer
hockey sunshine princess master shadow superman batman spiderman trustno trustnoone starwars pokemon minecraft fortnite roblox
whatever freedom hello helloworld charlie michael jennifer jordan hunter ranger buster thomas robert abc abcd abcde abcdef
abcdefg abcdefgh github impossibility impossibilitysimulator simulator croissant autocroissant ttscardmaker cardmaker card
cards computer internet killer pepper ginger cookie cheese chocolate summer winter spring autumn flower lovely loveme mustang
harley maggie jessica ashley daniel matthew andrew joshua amanda nicole tigger purple orange yellow silver golden diamond
access ninja qazwsx qazwsxedc zaq zaqxsw zaqwsx mypassword thisismypassword correcthorsebatterystaple thequickbrownfox
thequickbrownfoxjumpsoverthelazydog iloveyoutoo ihateyou fuckyou fuckoff asshole bigdick blink google facebook youtube
twitter discord apple samsung mother father family friend friends forever jesus god angel blessed`.split(/\s+/));
const LEET = [{ "@": "a", 4: "a", 3: "e", 1: "i", "!": "i", "|": "i", 0: "o", $: "s", 5: "s", 7: "t", 8: "b", 9: "g", "+": "t" },
  { "@": "a", 4: "a", 3: "e", 1: "l", "!": "l", "|": "l", 0: "o", $: "s", 5: "s", 7: "t", 8: "b", 9: "g", "+": "t" }];
// keyboard rows and columns, the alphabet and digits: a run along any of them (either way) is a sequence
const RUNS = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "qwertzuiop", "yxcvbnm",
  "azertyuiop", "qsdfghjklm", "wxcvbn", "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p", "zaq1xsw2cde3vfr4bgt5nhy6mju7"];
const stepOk = (a, b) => RUNS.some(r => { const i = r.indexOf(a); return i >= 0 && (r[i + 1] === b || r[i - 1] === b); });
/** One word (4+ letters, at most 2 more elsewhere) with digits and symbols around it: Liverpool1892, Charlie2024!x. A word is
 *  cased like one (liverpool, Liverpool, LIVERPOOL) and has vowels: random letters (uNTeFvHn) aren't. s: as typed (case kept). */
const oneWord = s => {
  const runs = s.split(/[^\p{L}]+/u).filter(Boolean), letters = runs.join("").length, top = runs.reduce((a, r) => (r.length > a.length ? r : a), "");
  return top.length >= 4 && letters - top.length <= 2 && letters <= 12 && /^(\p{Lu}?\p{Ll}+|\p{Lu}+)$/u.test(top)
    && (top.toLowerCase().match(/[aeiouy]/g) || []).length / top.length >= 0.25;
};
/** A core with digits and symbols around it stripped, leetspeak undone, when it is mostly letters already (L1verp00l). */
const leetWord = e => (e.replace(/[^\p{L}]/gu, "").length >= 0.7 * [...e].length ? LEET.map(m => [...e].map(ch => m[ch] ?? ch).join("")) : []);
const commonCore = core => !!core && (COMMON.has(core) || [...COMMON].some(w => w.length >= 3 && core.length % w.length === 0 && w.repeat(core.length / w.length) === core));
/** Words of a passphrase: runs of 3+ characters with a letter, split on spaces and - _ . , + / */
export const wordsOf = pw => String(pw ?? "").split(/[\s\-_.,;:+/]+/).filter(w => [...w].length >= 3 && /\p{L}/u.test(w));
/** {ok, problems: [why], length, words}: at least 12 characters, and none of the first guesses. */
export function checkPassword(pw, login = "", token = "") {
  pw = String(pw ?? "").normalize("NFC");
  const length = [...pw].length, words = wordsOf(pw).length, low = pw.toLowerCase(), problems = [];
  if (!length) return { ok: false, problems: ["Type a password"], length, words };
  if (length < LIMITS.min) problems.push(`Too short: at least ${LIMITS.min} characters (${LIMITS.words} or more random words are easy to remember)`);
  if (length > LIMITS.max) problems.push(`Too long: at most ${LIMITS.max} characters`);
  if ((token && pw.trim() === token.trim()) || /^(ghp|gho|ghu|ghs|ghr)_|^github_pat_/i.test(pw.trim())) problems.push("That's a GitHub token: pick a password you can remember instead");
  const lg = String(login ?? "").toLowerCase();    // without the login: still long enough? (one under 4 characters only as a word of its own: "al" is in many words)
  const rest = !lg ? low : lg.length >= 4 ? low.split(lg).join("") : low.replace(new RegExp(`(?<![\\p{L}\\d])${lg}(?![\\p{L}\\d])`, "gu"), "");
  if (rest !== low && [...rest].length < LIMITS.min) problems.push("Mostly your GitHub login: add more than the login");
  const ends = [low, low.replace(/[\d\W_]+$/u, ""), low.replace(/^[\d\W_]+/u, ""), low.replace(/^[\d\W_]+|[\d\W_]+$/gu, "")];   // digits and symbols around
  const cores = [low.replace(/[^\p{L}]/gu, ""), ...ends.flatMap(e => LEET.map(m => [...e].map(ch => m[ch] ?? ch).join("").replace(/[^\p{L}]/gu, "")))];
  if (!cores[0]) { if (length < 16) problems.push("Only digits and symbols: add words, or use 16 or more"); }
  else if (cores.some(commonCore)) problems.push("Too common: a well-known password (with digits or symbols around it) is among the first guesses");
  else if (length < 16 && [pw, ...leetWord(pw.replace(/^[\d\W_]+|[\d\W_]+$/gu, ""))].some(oneWord)) problems.push("One word with digits or symbols around it (like Liverpool1892): a dictionary with years finds it fast; add more words");
  if (/^(.+?)\1+$/su.test(low)) problems.push("Repeats a short pattern");
  const chars = [...low.replace(/\s/g, "")];
  if (chars.length > 3) {
    let seq = 0; for (let i = 1; i < chars.length; i++) if (stepOk(chars[i - 1], chars[i]) || chars[i] === chars[i - 1]) seq++;
    if (seq / (chars.length - 1) >= 0.75) problems.push("A keyboard or alphabet run (like qwerty, abcd or 1234)");
  }
  if (new Set(chars).size < 5) problems.push("Uses too few different characters");
  return { ok: !problems.length, problems: [...new Set(problems)], length, words };
}

// ---- this device: the token sealed under a key that can't leave IndexedDB ---------------------------------
export const SEALED = "edit-token-sealed";        // {v, iv, ct}: localStorage (kept) or sessionStorage (this tab only)
const DB = "ttscardmaker-signin", STORE = "keys", KEY_ID = "device", DEVICE_AAD = "device:token";
/** The device vault. env (for tests): idb, subtle, local, session, random. */
export function vault({ idb = globalThis.indexedDB, subtle = globalThis.crypto?.subtle, local = globalThis.localStorage,
  session = globalThis.sessionStorage, random = a => globalThis.crypto.getRandomValues(a) } = {}) {
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const openDb = () => { if (!idb) return Promise.reject(new Error("no IndexedDB")); const r = idb.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); return req(r); };
  async function withStore(mode, fn) {                // one request in its own transaction; resolves once it committed
    const db = await openDb();
    try {
      const t = db.transaction(STORE, mode);
      const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error || new Error("aborted")); });
      const [v] = await Promise.all([req(fn(t.objectStore(STORE))), done]);
      return v;
    } finally { db.close(); }
  }
  async function deviceKey(create) {
    const key = await withStore("readonly", s => s.get(KEY_ID));
    if (key || !create) return key || null;
    const fresh = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);   // non-extractable
    try { await withStore("readwrite", s => s.add(fresh, KEY_ID)); return fresh; }
    catch { return (await withStore("readonly", s => s.get(KEY_ID))) || null; }   // another tab made one first
  }
  const drop = () => { try { local?.removeItem(SEALED); } catch { /* blocked storage */ } try { session?.removeItem(SEALED); } catch { /* blocked storage */ } };
  return {
    /** Whether a sealed token waits (sync: the boot's "signing in…"). */
    has: () => { try { return !!(local?.getItem(SEALED) || session?.getItem(SEALED)); } catch { return false; } },
    /** Seals the token: localStorage when kept, else sessionStorage. Throws when this browser can't (no IndexedDB, no crypto). */
    async save(token, keep) {
      if (!subtle) throw new Error("no crypto.subtle");
      const key = await deviceKey(true);
      if (!key) throw new Error("no device key");
      const iv = random(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(DEVICE_AAD) }, key, utf8(token));
      drop();
      (keep ? local : session).setItem(SEALED, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) }));
    },
    /** {token, keep} or null; an unreadable blob (key gone, another browser's) is dropped. */
    async load() {
      let text = null, keep = false;
      try { text = local?.getItem(SEALED); keep = !!text; text ||= session?.getItem(SEALED); } catch { return null; }
      if (!text || !subtle) return null;
      try {
        const blob = JSON.parse(text), key = await deviceKey(false);
        if (!key) throw new Error("no device key");
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv), additionalData: utf8(DEVICE_AAD) }, key, unb64(blob.ct));
        return { token: new TextDecoder().decode(plain), keep };
      } catch { drop(); return null; }
    },
    /** Sign out: both blobs and the device key. */
    async clear() { drop(); try { await withStore("readwrite", s => s.delete(KEY_ID)); } catch { /* no IndexedDB: nothing kept */ } },
  };
}

// ---- forms (edit.js shows and wires them) -------------------------------------------------------------------
const SCOPES = "https://github.com/settings/tokens/new?scopes=public_repo&description=Impossibility%20Simulator%20card%20browser";
/** The signed-out hub: Password (login + password) or Token. mode: "password" | "token"; last: the login last used here. */
export function signInHtml({ mode = "token", last = "", note = "", repo = "", logins = "site/logins", forgot = false } = {}) {
  const pw = mode === "password";
  return `<h3>Sign in to edit</h3>${note ? `<p>${esc(note)}</p>` : ""}
    <p class="muted">Anyone with write access to ${esc(repo)} can edit cards and make a profile. Edits are batched and published as one commit, which the website and the bot both read.</p>
    <div class="seg signin-modes" role="group" aria-label="Sign in with"><button type="button" data-signin-mode="password" class="${pw ? "on" : ""}" aria-pressed="${pw}">Password</button><button type="button" data-signin-mode="token" class="${pw ? "" : "on"}" aria-pressed="${!pw}">Token</button></div>
    <form id="signin-pw-form" class="signin-form"${pw ? "" : " hidden"}>
      <label for="signin-login">GitHub login</label><input id="signin-login" class="wide" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(last)}" required>
      <label for="signin-password">Password</label><input id="signin-password" class="wide" type="password" autocomplete="current-password" required>
      <label class="check"><input id="signin-pw-remember" type="checkbox" checked> keep me signed in on this browser</label>
      <div class="actions"><button type="submit" class="primary">Sign in</button><button type="button" class="ghost" data-pw-forgot>Forgot password?</button></div>
      <p class="muted" id="signin-pw-status" aria-live="polite"></p>
      <p class="muted">No password yet? Sign in with your token once, then set one.</p></form>
    <div id="signin-token-box"${pw ? " hidden" : ""}>
      ${forgot ? `<p class="note">Forgot your password: sign in with your token, then set a new password. It replaces the old one.</p>` : ""}
      <ol class="muted"><li><a href="${SCOPES}" target="_blank" rel="noopener">Create a GitHub token</a> with only <code>public_repo</code> ticked.</li><li>Paste it here.</li></ol>
      <form id="signin-form"><input id="signin-token" class="wide" type="password" placeholder="ghp_…" autocomplete="off" required aria-label="GitHub token">
        <label class="check"><input id="signin-remember" type="checkbox" checked> keep me signed in on this browser</label>
        <div class="actions"><button type="submit" class="primary">Sign in</button></div><p class="muted" id="signin-status" aria-live="polite"></p></form></div>
    <p class="muted signin-safety"><b>Safety.</b> The token only needs <code>public_repo</code> and is only sent to api.github.com. This browser keeps it
      encrypted with a key that can't leave the browser (Sign out removes both). A password file (<code>${esc(logins)}/&lt;login&gt;.json</code>)
      is public: it holds your token encrypted with your password, so anyone can try to guess the password offline. A long
      password you use nowhere else is what keeps it safe.</p>`;
}
/** The password checks as a list: each problem, or one line saying it's fine. */
export function checksHtml(r, again = null) {
  const lines = r.length ? r.problems.map(p => `<li class="err">✗ ${esc(p)}</li>`) : [];
  if (r.length && !r.problems.length) lines.push(`<li class="ok">✓ ${r.words >= LIMITS.words ? `A passphrase of ${r.words} words` : `${r.length} characters`}, not a common one</li>`);
  if (again === false) lines.push(`<li class="err">✗ The two don't match</li>`);
  return lines.join("");
}
/** The set / change password dialog. mode: "set" (offered after a token sign-in), "new" (forgot), "change". */
export function passwordFormHtml({ mode = "set", login = "", path = "", offer = false } = {}) {
  const title = mode === "change" ? "Change your password" : mode === "new" ? "Set a new password" : offer ? `Signed in as ${login}. Set a password?` : "Set a password";
  return `<h3>${esc(title)}</h3>
    <p class="muted">Then, on any device, sign in with <b>${esc(login)}</b> and this password instead of the token${mode === "set" ? "" : ` (it replaces the old one at once)`}.</p>
    <form id="pw-form" class="pw-form" autocomplete="on">
      <input type="text" name="username" autocomplete="username" value="${esc(login)}" hidden readonly>
      <label for="pw-new">${mode === "set" ? "Password" : "New password"}</label><input id="pw-new" class="wide" type="password" autocomplete="new-password" required>
      <label for="pw-again">Again</label><input id="pw-again" class="wide" type="password" autocomplete="new-password" required>
      <ul class="checks" id="pw-checks" aria-live="polite"></ul>
      <p class="note">Your token is encrypted here, in this browser, and published as <code>${esc(path)}</code>: public, like everything in the repo.
        Anyone can try to guess the password offline, so make it long (${LIMITS.min}+ characters; ${LIMITS.words}+ random words are easy to remember) and use it nowhere else.
        The password itself is never sent or stored.${mode === "change" ? " The old file stays in the git history: if the old password may be known, make a new token on GitHub, sign in with it, then set the password." : ""}</p>
      <div class="actions"><button type="submit" class="primary">${mode === "change" ? "Change password" : "Set password"}</button>${offer ? `<button type="button" class="ghost" data-action="pw-later">Not now</button>` : ""}</div>
      <p class="muted" id="pw-status" aria-live="polite"></p></form>`;
}
