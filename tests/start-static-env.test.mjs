/** start-static.sh reads apps/web/.env.local the way Next does.
 *
 *    node tests/start-static-env.test.mjs
 *
 *  PocketBase's superuser password comes from POCKETBASE_ADMIN_PASSWORD in
 *  .env.local, read by start-static.sh, while Next signs in to PocketBase
 *  with the same key as Next's own loader (@next/env) reads it. A password
 *  with `#`, `$` or a quote in it used to read differently on the two sides,
 *  so the superuser got a password Next did not know.
 *
 *  No PocketBase, no Next, no Discord: start-static.sh is copied into a temp
 *  root, both services are swapped for a fake that records its environment
 *  (WATCHDOG_CMD_PB / WATCHDOG_CMD_NEXT), and the build is skipped. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'apps/web/package.json'));
const { loadEnvConfig } = require('@next/env');

const failed = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed.push(name);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-static-env.'));
const root = path.join(tmp, 'root');
fs.mkdirSync(path.join(root, 'apps/web'), { recursive: true });
fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(REPO, 'start-static.sh'), path.join(root, 'start-static.sh'));
fs.copyFileSync(path.join(REPO, 'scripts/crash-report.mjs'), path.join(root, 'scripts/crash-report.mjs'));
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));

// Values a dotenv file reads in a way a plain `cut -d= -f2-` does not.
const envLocal = [
  'POCKETBASE_ADMIN_EMAIL=owner@example.com',
  'POCKETBASE_ADMIN_PASSWORD=Sup3r#Secret$tuff"x',
  "EMBER_ADMIN_PASSWORD='quoted # not a comment'",
  'EMBER_ADMIN_EMAIL=me@example.com # the owner',
  'PORT=3221 # the web app',
  'POCKETBASE_PORT=8248',
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'apps/web/.env.local'), envLocal);

const dump = path.join(tmp, 'env.json');
fs.writeFileSync(
  path.join(tmp, 'dump.mjs'),
  `import fs from 'node:fs';
const keys = ['EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD'];
fs.writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k]]))));
setInterval(() => {}, 1 << 30);
`,
);
const nextDump = path.join(tmp, 'next.json');
fs.writeFileSync(
  path.join(tmp, 'next.mjs'),
  `import fs from 'node:fs';
fs.writeFileSync(process.argv[2], JSON.stringify({ PORT: process.env.PORT }));
setInterval(() => {}, 1 << 30);
`,
);

// What Next itself makes of that file.
const nextEnv = loadEnvConfig(path.join(root, 'apps/web'), false, { info() {}, error() {} }, true).combinedEnv;

const env = { ...process.env };
for (const k of ['PORT', 'POCKETBASE_PORT', 'POCKETBASE_ADMIN_EMAIL', 'POCKETBASE_ADMIN_PASSWORD',
  'EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD',
  'EMBER_BACKUP_CRON', 'EMBER_BACKUP_KEEP', 'DISCORD_BUG_REPORT_WEBHOOK_URL']) delete env[k];
Object.assign(env, {
  WATCHDOG_SKIP_BUILD: '1',
  WATCHDOG_CMD_PB: `exec node "${path.join(tmp, 'dump.mjs')}" "${dump}"`,
  WATCHDOG_CMD_NEXT: `exec node "${path.join(tmp, 'next.mjs')}" "${nextDump}"`,
  // Never a real webhook: nothing should post, and if it did it goes nowhere.
  DISCORD_CRASH_WEBHOOK_URL: 'http://127.0.0.1:9/hook',
});

const wd = spawn('bash', [path.join(root, 'start-static.sh')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
wd.stdout.on('data', (d) => { out += d; });
wd.stderr.on('data', (d) => { out += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 20000;
while (Date.now() < deadline && !(fs.existsSync(dump) && fs.existsSync(nextDump))) await sleep(100);

try {
  check('the fake services started', fs.existsSync(dump) && fs.existsSync(nextDump), out.slice(-2000));
  if (fs.existsSync(dump) && fs.existsSync(nextDump)) {
    const pb = JSON.parse(fs.readFileSync(dump, 'utf8'));
    const next = JSON.parse(fs.readFileSync(nextDump, 'utf8'));
    check('PocketBase gets the superuser password Next signs in with',
      pb.EMBER_PB_SUPERUSER_PASSWORD === nextEnv.POCKETBASE_ADMIN_PASSWORD,
      `PocketBase ${JSON.stringify(pb.EMBER_PB_SUPERUSER_PASSWORD)}, Next ${JSON.stringify(nextEnv.POCKETBASE_ADMIN_PASSWORD)}`);
    check('PocketBase gets the superuser email Next uses',
      pb.EMBER_PB_SUPERUSER_EMAIL === nextEnv.POCKETBASE_ADMIN_EMAIL,
      `PocketBase ${JSON.stringify(pb.EMBER_PB_SUPERUSER_EMAIL)}, Next ${JSON.stringify(nextEnv.POCKETBASE_ADMIN_EMAIL)}`);
    check('a quoted owner password keeps its #',
      pb.EMBER_ADMIN_PASSWORD === 'quoted # not a comment', JSON.stringify(pb.EMBER_ADMIN_PASSWORD));
    check('an inline comment is not part of the owner email',
      pb.EMBER_ADMIN_EMAIL === 'me@example.com', JSON.stringify(pb.EMBER_ADMIN_EMAIL));
    check('an inline comment is not part of the port', next.PORT === '3221', JSON.stringify(next.PORT));
  }
} finally {
  wd.kill('SIGTERM');
  await new Promise((r) => {
    const t = setTimeout(() => { wd.kill('SIGKILL'); r(); }, 15000);
    wd.on('exit', () => { clearTimeout(t); r(); });
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
process.exit(failed.length ? 1 : 0);
