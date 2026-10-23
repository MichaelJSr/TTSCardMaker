# Passwords

One file per person who set a password on the card browser: `<login>.json`, where `<login>` is their GitHub login
exactly as GitHub spells it. It holds their GitHub token encrypted in their browser with their password, so they can sign
in on any device with their login and password instead of pasting the token. Written by the website (sign in with the
token → **Set a password**; the hub's **Change password** and **Remove my password**), each change committed at once as
its own commit, never by hand. Only the owner writes their file; admins may remove anyone's. The build
(`site/build/build_site.py`) checks the shape and copies each file to `data/logins/<login in lowercase>.json`; the sign-in
reads the file from GitHub's API first (current right after a change) and from that copy when the API can't be reached.

```json
{
  "at": "2026-10-23T01:45:00Z",
  "ct": "<base64: AES-GCM ciphertext of the token, with its 16-byte tag>",
  "iterations": 2000000,
  "iv": "<base64, 12 bytes>",
  "kdf": "PBKDF2-SHA-256",
  "login": "MichaelJSr",
  "salt": "<base64, 16 bytes>",
  "v": 1
}
```

- Key = PBKDF2-HMAC-SHA-256(password in Unicode NFC, salt, `iterations`), 256 bits; `ct` = AES-GCM-256 of the token
  (UTF-8) with the 12-byte `iv` and the string `login:<login in lowercase>` as additional data, so a file copied under
  another name does not open. `iterations` is 2,000,000 (0.2 s in Chrome on an M2 Ultra, about a second on a mid-range
  phone); 1,000,000 to 10,000,000 are accepted. `at`: when it was published.
- The file is public, like everything in the repo: anyone can try to guess the password offline. The website refuses
  passwords under 12 characters (unless a passphrase of 4 or more words), well-known ones (also with digits or symbols
  around them), repeated patterns, keyboard and alphabet runs, ones with too few different characters, ones that are mostly the
  login, and GitHub tokens. The token needs only the `public_repo` scope.
- A removed or replaced file stays in the git history: whoever knows an old password can still read the token it held.
  The website says so on Remove and Change; the fix is a new token (regenerate it on GitHub, sign in with it, set the
  password again).
- Signing in checks the token with GitHub (the login must be the file's, with the `public_repo` scope and push access),
  then this browser keeps it encrypted under a key that can't leave the browser (IndexedDB), never in plain text, until
  Sign out.

The build never fails on a password file: one that isn't JSON, is over 4 KB, has another `v`, a `login` other than its
file name, another `kdf`, `iterations` out of range, or a wrong `salt`, `iv` or `ct` shape is skipped with a warning; a
bad `at` is ignored, as are unknown fields.
