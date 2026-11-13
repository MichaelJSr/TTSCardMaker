// This browser's secrets: the GitHub token (sign-in: signin.js) and remembered deck passphrases, kept encrypted under
// device keys that can't leave IndexedDB (never in plain text). DOM-free at import.

// ---- base64 (decks.js, signin.js) ------------------------------------------------------------------
export const b64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = text => Uint8Array.from(atob(String(text ?? "")), ch => ch.charCodeAt(0));
export const utf8 = s => new TextEncoder().encode(s);

// ---- this device: secrets sealed under keys that can't leave IndexedDB ---------------------------------------
export const SEALED = "edit-token-sealed";        // {v, iv, ct}: localStorage (kept) or sessionStorage (this tab only)
export const PASS_SEALED = "deckPassSealed:";   // + "<owner lowercase>/<slug>": a remembered deck passphrase
const DB = "ttscardmaker-signin", STORE = "keys", KEY_ID = "device", DEVICE_AAD = "device:token", DECKS_ID = "decks";
/** Keys in IndexedDB `ttscardmaker-signin`/`keys`, one per id, each a non-extractable AES-GCM key made on first use. */
function keyring({ idb, subtle, random }) {
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
  async function keyOf(id, create) {
    const key = await withStore("readonly", s => s.get(id));
    if (key || !create) return key || null;
    const fresh = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);   // non-extractable
    try { await withStore("readwrite", s => s.add(fresh, id)); return fresh; }
    catch { return (await withStore("readonly", s => s.get(id))) || null; }   // another tab made one first
  }
  return {
    /** The blob text {v, iv, ct}; throws when this browser can't (no IndexedDB, no crypto). */
    async seal(id, aad, text) {
      if (!subtle) throw new Error("no crypto.subtle");
      const key = await keyOf(id, true);
      if (!key) throw new Error("no device key");
      const iv = random(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, key, utf8(text));
      return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) });
    },
    /** The text in a blob; throws when it can't be opened (key gone, another browser's, altered). */
    async open(id, aad, blobText) {
      if (!subtle) throw new Error("no crypto.subtle");
      const blob = JSON.parse(blobText), key = await keyOf(id, false);
      if (!key) throw new Error("no device key");
      return new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv), additionalData: utf8(aad) }, key, unb64(blob.ct)));
    },
    async remove(id) { try { await withStore("readwrite", s => s.delete(id)); } catch { /* no IndexedDB: nothing kept */ } },
  };
}
const safe = f => { try { return f(); } catch { return null; } };   // blocked storage throws on access
const envOf = ({ idb = safe(() => globalThis.indexedDB), subtle = globalThis.crypto?.subtle, local = safe(() => globalThis.localStorage),
  session = safe(() => globalThis.sessionStorage), random = a => globalThis.crypto.getRandomValues(a) } = {}) => ({ idb, subtle, local, session, random });
/** The device vault (the GitHub token). env (for tests): idb, subtle, local, session, random. */
export function vault(env) {
  const { subtle, local, session } = env = envOf(env), keys = keyring(env);
  const drop = () => { try { local?.removeItem(SEALED); } catch { /* blocked storage */ } try { session?.removeItem(SEALED); } catch { /* blocked storage */ } };
  return {
    /** Whether a sealed token waits (sync: the boot's "signing in…"). */
    has: () => { try { return !!(local?.getItem(SEALED) || session?.getItem(SEALED)); } catch { return false; } },
    /** Seals the token: localStorage when kept, else sessionStorage. Throws when this browser can't (no IndexedDB, no crypto). */
    async save(token, keep) {
      const blob = await keys.seal(KEY_ID, DEVICE_AAD, token);
      drop();
      (keep ? local : session).setItem(SEALED, blob);
    },
    /** {token, keep} or null; an unreadable blob (key gone, another browser's) is dropped. */
    async load() {
      let text = null, keep = false;
      try { text = local?.getItem(SEALED); keep = !!text; text ||= session?.getItem(SEALED); } catch { return null; }
      if (!text || !subtle) return null;
      try { return { token: await keys.open(KEY_ID, DEVICE_AAD, text), keep }; } catch { drop(); return null; }
    },
    /** Sign out: both blobs and the device key (the deck passphrases' key stays: they aren't tied to the sign-in). */
    async clear() { drop(); await keys.remove(KEY_ID); },
  };
}
/** Deck passphrases remembered on this device ("Remember on this device"), sealed in localStorage under their own key
 *  (`decks`, a sibling of the token's), the deck's key as additional data. Not tied to the sign-in: Sign out keeps
 *  them; each deck's Forget drops its own. deck: decks.keyOf(owner, slug). env as vault's. */
export function deckPasses(env) {
  const { local } = env = envOf(env), keys = keyring(env), aad = deck => `deck-pass:${deck}`;
  const get = k => { try { return local?.getItem(k) ?? null; } catch { return null; } };
  const del = k => { try { local?.removeItem(k); } catch { /* blocked storage */ } };
  const listed = prefix => { const out = []; try { for (let i = 0; i < local.length; i++) { const k = local.key(i); if (k?.startsWith(prefix)) out.push(k.slice(prefix.length)); } } catch { /* blocked storage */ } return out; };
  const forgets = new Map();   // deck -> Forget count: a save that started before a Forget stores nothing
  let saving = 0, removing = null;
  const api = {
    /** Whether one is remembered (sync). */
    has: deck => !!get(PASS_SEALED + deck),
    /** Remembers it (-> false when Forget ran meanwhile); throws when this browser can't keep it sealed (then nothing is stored). */
    async save(deck, pass) {
      if (!local) throw new Error("no localStorage");
      const n = forgets.get(deck) || 0;
      saving++;
      try {
        await removing;
        const blob = await keys.seal(DECKS_ID, aad(deck), pass);
        if ((forgets.get(deck) || 0) !== n) return false;
        local.setItem(PASS_SEALED + deck, blob);
        return true;
      } finally { saving--; }
    },
    /** The passphrase, or null; a sealed one that can't be opened is dropped. */
    async load(deck) {
      const blob = get(PASS_SEALED + deck);
      if (blob) { try { return await keys.open(DECKS_ID, aad(deck), blob); } catch { del(PASS_SEALED + deck); } }
      return null;
    },
    /** Drops it; the last one also deletes the `decks` key (resolves once that's done). */
    forget(deck) {
      forgets.set(deck, (forgets.get(deck) || 0) + 1);
      del(PASS_SEALED + deck);
      if (saving || removing || listed(PASS_SEALED).length) return removing || Promise.resolve();
      return (removing = keys.remove(DECKS_ID).finally(() => { removing = null; }));
    },
  };
  return api;
}
