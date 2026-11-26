// A Steam login token for workshop.yml, run on the Mac about every 200 days (the job warns 30 days ahead): approve the
// QR code in the Steam mobile app (or --account NAME: password, then the app or a code). The token goes straight into
// the environment secret STEAM_REFRESH_TOKEN through gh; it is never printed or written to disk.
//
//   cd .github/workshop && npm ci && node mint.mjs [--account NAME]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } = require('steam-session');
const qrcode = require('qrcode-terminal');

const REPO = 'MichaelJSr/TTSCardMaker', ENV = 'workshop', SECRET = 'STEAM_REFRESH_TOKEN';
const { values: opt } = parseArgs({ options: { account: { type: 'string' } } });

function ask(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.startsWith(question)) rl.output.write(question); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) console.log(); resolve(a.trim()); }));
}

const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
session.loginTimeout = 300_000;
session.on('authenticated', () => {
  const token = session.refreshToken;
  const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
  const gh = spawnSync('gh', ['secret', 'set', SECRET, '--env', ENV, '--repo', REPO], { input: token, stdio: ['pipe', 'inherit', 'inherit'] });
  if (gh.status !== 0) { console.error(`gh secret set failed (${gh.status}); nothing was saved`); process.exit(1); }
  console.log(`Saved ${SECRET} for ${session.accountName} in ${REPO} (environment ${ENV}); it expires ${new Date(exp).toISOString().slice(0, 10)}.`);
  process.exit(0);
});
session.on('timeout', () => { console.error('Not approved within 5 minutes; run it again.'); process.exit(1); });
session.on('error', (e) => { console.error(`Steam refused the login: ${e.message}`); process.exit(1); });

if (opt.account) {
  const start = await session.startWithCredentials({ accountName: opt.account, password: await ask('Steam password: ', true) });
  if (start.actionRequired) {
    const confirm = start.validActions.some((a) => a.type === EAuthSessionGuardType.DeviceConfirmation);
    const code = start.validActions.find((a) => [EAuthSessionGuardType.DeviceCode, EAuthSessionGuardType.EmailCode].includes(a.type));
    if (confirm) console.log('Approve the login in the Steam mobile app' + (code ? ', or type the code below.' : '.'));
    if (code) await session.submitSteamGuardCode(await ask(code.type === EAuthSessionGuardType.EmailCode ? 'Code from the email: ' : 'Steam Guard code: '));
  }
} else {
  const start = await session.startWithQR();
  qrcode.generate(start.qrChallengeUrl, { small: true });
  console.log('Scan this with the Steam mobile app (Steam Guard tab, the QR icon) and approve. Waiting up to 5 minutes...');
}
