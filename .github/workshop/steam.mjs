// The TTS save onto its Steam Workshop item, as TTS's own "Update Workshop" does it (the Steam client's logged steps):
// Cloud.BeginUGCUpload, an HTTP PUT, Cloud.CommitUGCUpload, then ClientUCMUpdatePublishedFile (EMsg 7325) with
// update_file. The item stays a legacy one-file item (what TTS loads; steamcmd's workshop_build_item would convert it).
// Login: STEAM_REFRESH_TOKEN (mint.mjs). Within 30 days of its expiry, after the upload, the run asks Steam for a new
// token and saves it with WORKSHOP_SECRETS_TOKEN, whose write access is proven first (a renewal voids the old token).
// Without it, or while Steam declines, the day's first run pings at 29 and 14 days and daily in the last week.
// The change note: the card changelog's player-facing events since the item's last update.
// Prints no secret. Outputs (GITHUB_OUTPUT): live_sha1, result (updated | unchanged), alert (lines for Discord).
//
//   node steam.mjs check  --item ID
//   node steam.mjs upload --item ID --file F --name NAME
import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const SteamUser = require('steam-user');
const Schema = require('steam-user/protobufs/generated/_load.js');
const { EMsg, EResult } = SteamUser;

const APP = 286160;                 // Tabletop Simulator
const WAIT = 30_000;                // one answer from Steam
const RENEW_DAYS = 30;
const REPO = process.env.GITHUB_REPOSITORY || 'MichaelJSr/TTSCardMaker';
const MINT = 'run .github/workshop/mint.mjs on the Mac again';
const { positionals: [mode], values: opt } = parseArgs({
  allowPositionals: true,
  options: { item: { type: 'string' }, file: { type: 'string' }, name: { type: 'string' } },
});

const out = (k, v) => {
  console.log(`${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v).replace(/\s+/g, ' ')}\n`);
};
const alerts = [];
const alert = (msg) => { console.log(`::warning::${msg}`); alerts.push(msg); };
let finished = false;
function finish(code, error) {                  // the one alert output: every alert of the run, a failure first
  if (finished) return;
  finished = true;
  if (error) { console.error(`::error::${error}`); alerts.unshift(`upload failed: ${error}`); }
  if (alerts.length) out('alert', alerts.join(' | '));
  process.exit(code);
}
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const within = (promise, ms, what) => Promise.race([promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms).unref())]);

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${new URL(url).host}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function expiry(token) {
  const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
  return { exp: new Date(exp).toISOString().slice(0, 10), days: Math.floor((exp - Date.now()) / 86_400_000) };
}

const gh = (args, input) => spawnSync('gh', args, { input, stdio: ['pipe', 'ignore', 'ignore'], timeout: 60_000,
  env: { ...process.env, GH_TOKEN: process.env.WORKSHOP_SECRETS_TOKEN } }).status === 0;
const env = ['--env', 'workshop', '--repo', REPO];

// WORKSHOP_SECRETS_TOKEN really writes the environment's secrets: a probe secret set and deleted
const canWrite = () => gh(['secret', 'set', 'WORKSHOP_WRITE_PROBE', ...env], 'probe') &&
  gh(['secret', 'delete', 'WORKSHOP_WRITE_PROBE', ...env]);

async function renewal(client, token) {
  const { exp, days } = expiry(token);
  if (days >= RENEW_DAYS) return;
  const warn = () => {
    if (process.env.FIRST_TODAY === 'true' && (days <= 7 || days === 29 || days === 14)) {
      alert(`the Steam login token expires ${exp} (${days} days): ${MINT}`);
    }
  };
  if (!process.env.WORKSHOP_SECRETS_TOKEN) return warn();
  if (!canWrite()) {
    alert('WORKSHOP_SECRETS_TOKEN cannot write the workshop environment\'s secrets, so the Steam token is not renewed');
    return warn();
  }
  const session = client._getLoginSession();   // steam-user's own renewal path, over this authenticated session
  session.refreshToken = token;
  let renewed;
  try {
    renewed = await within(session.renewRefreshToken(), 60_000, 'token renewal');
  } catch (e) {
    alert(`Steam did not renew the login token (${e.message})`);
    return warn();
  }
  if (!renewed || session.refreshToken === token) {
    console.log('Steam issued no new login token yet');
    return warn();
  }
  if (gh(['secret', 'set', 'STEAM_REFRESH_TOKEN', ...env], session.refreshToken)) {
    console.log(`login token renewed until ${expiry(session.refreshToken).exp} and saved`);
  } else {
    alert(`Steam renewed the login token but saving it failed, and the old one no longer works: ${MINT}`);
  }
}

function logOn(token) {
  const client = new SteamUser({ dataDirectory: null, autoRelogin: false, renewRefreshTokens: false });
  return within(new Promise((resolve, reject) => {
    client.once('loggedOn', () => resolve(client));
    client.once('error', (e) => reject(new Error(`logon: ${EResult[e.eresult] || e.message}`)));
    client.logOn({ refreshToken: token, logonID: randomInt(1, 2 ** 31), machineName: 'GitHub Actions (Workshop)' });
  }), 60_000, 'logon');
}

// One message with a job id; its answer decoded. Steam's eresult other than OK rejects: a service method's in the
// answer's header, a UCM message's in its body (its header's field is absent and decodes as the default, Fail).
function call(client, header, body, Res) {
  const what = header.proto.target_job_name || EMsg[header.msg];
  return within(new Promise((resolve, reject) => {
    client._send(header, body, (answer, head) => {
      const raw = Buffer.isBuffer(answer) ? answer : answer.toBuffer();
      const res = Res.toObject(Res.decode(raw), { longs: String, defaults: true });
      const er = header.proto.target_job_name ? head?.proto?.eresult : res.eresult;
      if (er !== 1) return reject(new Error(`${what}: ${EResult[er] || er} ${head?.proto?.error_message || ''}`.trim()));
      resolve(res);
    });
  }), WAIT, what);
}
const encode = (Req, data) => Buffer.from(Req.encode(Req.fromObject(data)).finish());
const unified = (client, method, body, Res) =>
  call(client, { msg: EMsg.ServiceMethodCallFromClient, proto: { target_job_name: method } }, body, Res);

function varint(n) {
  const bytes = [];
  let v = BigInt(n);
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; bytes.push(b); } while (v);
  return Buffer.from(bytes);
}

async function details(client, item) {
  const { files } = await within(client.getPublishedFileDetails([item]), WAIT, 'PublishedFile.GetDetails');
  const d = files[item];
  if (!d) throw new Error(`item ${item}: no details`);
  if (d.result !== 1) throw new Error(`item ${item}: ${EResult[d.result] || d.result}`);
  return d;
}

function check(client, d) {
  const mine = d.creator && d.creator.getSteamID64() === client.steamID.getSteamID64();
  console.log(`item ${d.publishedfileid} "${d.title}": app ${d.consumer_appid}, file '${d.filename}', ${d.file_size} bytes, ` +
    `visibility ${d.visibility}, updated ${new Date(d.time_updated * 1000).toISOString()}, owned by this login: ${mine}`);
  if (!mine) throw new Error('the item is not this login\'s');
  if (d.consumer_appid !== APP) throw new Error(`not a Tabletop Simulator item (app ${d.consumer_appid})`);
  if (!d.filename || !d.file_url) throw new Error('not a legacy one-file item: TTS could not load it, refusing to touch it');
}

async function liveSha(d) {
  const tail = d.file_url.replace(/\/+$/, '').split('/').pop();
  if (/^[0-9a-f]{40}$/i.test(tail)) return tail.toLowerCase();       // the CDN names the file by its SHA-1
  return sha1(await download(d.file_url));
}

// The card changelog's player-facing events since `since` (epoch s), as the Discord changelog picks them: no sweeps,
// no minor versions, nothing from the guards' pushes. Its files are split by Los Angeles months: two days of margin.
async function changeNote(since) {
  const sections = [['new', 'New cards'], ['changed', 'Changed'], ['edited', 'Changed'], ['art', 'New art'],
    ['renamed', 'Renamed'], ['archived', 'Removed'], ['restored', 'Back']];
  const label = Object.fromEntries(sections);
  const names = new Map();
  const start = new Date((since - 2 * 86400) * 1000);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); Date.UTC(y, m) <= Date.now(); m === 11 ? (y++, m = 0) : m++) {
    const month = `${y}-${String(m + 1).padStart(2, '0')}`;
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/data/db/changelog/${month}.jsonl`);
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(`changelog ${month}: HTTP ${r.status}`);
    for (const line of (await r.text()).split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!(e.at > since) || !label[e.kind] || e.sweep || e.minor || e.push?.by === 'Card guards') continue;
      const name = e.kind === 'renamed' && e.renamed_to ? `${e.card} -> ${e.renamed_to}` : e.title || e.card;
      if (!names.has(label[e.kind])) names.set(label[e.kind], new Set());
      names.get(label[e.kind]).add(name);
    }
  }
  const text = [...new Set(sections.map(([, l]) => l))].filter((l) => names.has(l))
    .map((l) => `${l}: ${[...names.get(l)].join(', ')}`).join('\n');
  return (text || 'Table and rulebook updates.').slice(0, 7000);
}

async function putFile(client, data, name) {
  const S = Schema;
  const body = Buffer.concat([   // + timestamp (field 7), which steam-user's proto lacks; the client sends it, not is_public (6)
    encode(S.CCloud_BeginUGCUpload_Request, { appid: APP, file_size: data.length, filename: name, file_sha: sha1(data),
      content_type: 'application/octet-stream' }),
    Buffer.from([7 << 3]), varint(Math.floor(Date.now() / 1000))]);
  const begin = await unified(client, 'Cloud.BeginUGCUpload#1', body, S.CCloud_BeginUGCUpload_Response);
  const url = `${begin.use_https ? 'https' : 'http'}://${begin.url_host}${begin.url_path}`;
  const headers = Object.fromEntries(begin.request_headers.map((h) => [h.name, h.value]));
  let why = '';
  try {
    const put = await within(fetch(url, { method: 'PUT', headers, body: data }), 300_000, 'upload PUT');
    if (!put.ok) why = `HTTP ${put.status} ${(await put.text()).slice(0, 200)}`;
  } catch (e) { why = e.message; }
  const commit = await unified(client, 'Cloud.CommitUGCUpload#1',
    encode(S.CCloud_CommitUGCUpload_Request, { transfer_succeeded: !why, appid: APP, ugcid: begin.ugcid }),
    S.CCloud_CommitUGCUpload_Response);
  if (why) throw new Error(`upload PUT: ${why}`);
  if (!commit.file_committed) throw new Error('Cloud.CommitUGCUpload: file not committed');
  console.log(`uploaded ${data.length} bytes as '${name}'`);
}

async function work(client) {
  const d = await details(client, opt.item);
  check(client, d);
  const live = await liveSha(d);
  out('live_sha1', live);
  if (mode === 'check') return;
  const data = readFileSync(opt.file);
  const ours = sha1(data);
  if (live === ours) { out('result', 'unchanged'); return; }
  const note = await changeNote(Number(d.time_updated)).catch((e) => {
    console.log(`::warning::change note: ${e.message}`);
    return 'Update from the card repo.';
  });
  console.log(`change note:\n${note}`);
  await putFile(client, data, opt.name);
  const res = await call(client, { msg: EMsg.ClientUCMUpdatePublishedFile, proto: {} },
    encode(Schema.CMsgClientUCMUpdatePublishedFile, { app_id: APP, published_file_id: opt.item, file_name: opt.name,
      update_file: true, change_description: note }), Schema.CMsgClientUCMUpdatePublishedFileResponse);
  if (res.needs_workshop_legal_agreement_acceptance) alert('Steam asks you to accept the Workshop legal agreement');
  for (let i = 0; i < 24; i++) {                              // the item serves our bytes: done
    const now = await details(client, opt.item);
    if (now.filename && now.file_url && (await liveSha(now)) === ours) { out('result', 'updated'); return; }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('updated, but the item does not serve the new file after 2 minutes');
}

async function main() {
  if (!['check', 'upload'].includes(mode)) throw new Error('mode: check | upload');
  const token = process.env.STEAM_REFRESH_TOKEN;
  if (!token) throw new Error(`no STEAM_REFRESH_TOKEN: ${MINT}`);
  const { exp, days } = expiry(token);
  console.log(`login token expires ${exp} (${days} days)`);
  if (days < 0) throw new Error(`the Steam login token has expired: ${MINT}`);
  const client = await logOn(token);
  let failed = null;
  try { await work(client); } catch (e) { failed = e; }
  try { await renewal(client, token); } catch (e) { alert(`token renewal: ${e.message}`); }   // after the upload, failed or not
  client.logOff();
  if (failed) throw failed;
}

process.on('uncaughtException', (e) => finish(1, e.message));
process.on('unhandledRejection', (e) => finish(1, e?.message || String(e)));
main().then(() => setTimeout(() => finish(0), 500), (e) => finish(1, e.message));
