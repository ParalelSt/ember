/** scripts/crash-report.mjs, the dependency-free Discord poster the watchdog
 *  and the server's uncaught-error handler both call.
 *
 *      node tests/crash-report.test.mjs   # or: npm run test:crash-report
 *
 *  No server, no PocketBase, no network: the webhook is tests/fake-discord.mjs
 *  on a random local port. Every CLI run gets EMBER_LOG_DIR in a temp dir so
 *  the repo's own logs/crash-report.state is never read or written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  resolveWebhook,
  extractDefaultWebhook,
  scrubText,
  takeRateSlot,
  RATE_LIMIT,
} from '../scripts/crash-report.mjs';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-report-test-'));
const FIXTURE_ROUTE = 'tests/fixtures/crash-report/bug-report-route.txt';

// ── webhook resolution ────────────────────────────────────────────────────
{
  const envFile = path.join(TMP, 'env.local');
  fs.writeFileSync(
    envFile,
    '# comment\nPORT=3000\nDISCORD_CRASH_WEBHOOK_URL="http://file-crash/hook"\r\nDISCORD_BUG_REPORT_WEBHOOK_URL=http://file-bug/hook\n',
  );
  const bugOnlyFile = path.join(TMP, 'env-bug-only.local');
  fs.writeFileSync(bugOnlyFile, 'DISCORD_BUG_REPORT_WEBHOOK_URL=http://file-bug/hook\n');
  const missing = path.join(TMP, 'nope.local');

  check(
    'crash env var wins over everything',
    resolveWebhook({
      env: { DISCORD_CRASH_WEBHOOK_URL: 'http://env-crash/hook', DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://env-bug/hook' },
      envFile,
      routeFile: FIXTURE_ROUTE,
    }) === 'http://env-crash/hook',
  );
  check(
    'bug-report env var is next',
    resolveWebhook({ env: { DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://env-bug/hook' }, envFile, routeFile: FIXTURE_ROUTE }) ===
      'http://env-bug/hook',
  );
  check(
    '.env.local crash webhook (quotes and CR stripped) after the process env',
    resolveWebhook({ env: {}, envFile, routeFile: FIXTURE_ROUTE }) === 'http://file-crash/hook',
  );
  check(
    '.env.local bug-report webhook when it has no crash one',
    resolveWebhook({ env: {}, envFile: bugOnlyFile, routeFile: FIXTURE_ROUTE }) === 'http://file-bug/hook',
  );
  check(
    'falls back to DEFAULT_WEBHOOK_URL extracted from the route source',
    resolveWebhook({ env: {}, envFile: missing, routeFile: FIXTURE_ROUTE }) === 'http://127.0.0.1:9/fixture-default-hook',
  );
  check('a missing route file resolves to empty, not a throw', extractDefaultWebhook(path.join(TMP, 'none.ts')) === '');
  // Webhooks are env-only now (the hardcoded default was removed after a
  // public secret scanner found it and Discord deleted that webhook): the
  // real lib/reports/discord.ts no longer defines DEFAULT_WEBHOOK_URL at
  // all, so extraction against it must come back empty, not a live URL.
  check(
    'no real webhook default lives in lib/reports/discord.ts anymore',
    extractDefaultWebhook('apps/web/lib/reports/discord.ts') === '',
  );
}

// ── scrubbing ─────────────────────────────────────────────────────────────
{
  const out = scrubText('GET /api/x Authorization: Bearer abcdefghijklmnop.qrs\ncookie: pb_auth=secret; a=b\nfine line');
  check('scrubs a bearer token', !out.includes('abcdefghijklmnop') && out.includes('bearer [scrubbed]'), out.split('\n')[0]);
  check('scrubs a cookie header', !out.includes('pb_auth=secret'));
  check('leaves ordinary lines alone', out.includes('fine line'));
}

// ── rate limit state ──────────────────────────────────────────────────────
{
  const state = path.join(TMP, 'rate', 'crash-report.state');
  const t0 = 1_700_000_000_000;
  const decisions = [];
  for (let i = 0; i < RATE_LIMIT + 3; i++) decisions.push(takeRateSlot(state, t0 + i * 1000));
  check(`first ${RATE_LIMIT} posts in an hour go out`, decisions.slice(0, RATE_LIMIT).every((d) => d === 'post'));
  check('the next one is the single mute notice', decisions[RATE_LIMIT] === 'mute-notice');
  check('after that, silence', decisions.slice(RATE_LIMIT + 1).every((d) => d === 'silent'));
  const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
  check('state file records the posts and the mute time', saved.posts.length === RATE_LIMIT && saved.mutedAt > 0);
  check('an hour later posting resumes', takeRateSlot(state, t0 + 60 * 60 * 1000 + RATE_LIMIT * 1000) === 'post');
}

// ── CLI end to end against a fake webhook ─────────────────────────────────
// Every sink is killed on exit, even when a check throws, so a failed run
// never leaves a stray server holding the terminal open.
const sinks = [];
process.on('exit', () => sinks.forEach((p) => p.kill('SIGKILL')));

/** Splits a recorded multipart body into { name, filename, content } parts. */
function parseMultipart(post) {
  const boundary = post.contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundary) return [];
  const sep = `--${boundary[1] ?? boundary[2]}`;
  return post.body
    .split(sep)
    .slice(1, -1)
    .map((chunk) => {
      const [head, ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
      return {
        name: head.match(/name="([^"]*)"/)?.[1],
        filename: head.match(/filename="([^"]*)"/)?.[1],
        content: rest.join('\r\n\r\n').replace(/\r\n$/, ''),
      };
    });
}
async function startSink(status = 204) {
  const record = path.join(TMP, `sink-${status}-${Date.now()}.jsonl`);
  fs.writeFileSync(record, '');
  const proc = spawn(process.execPath, ['tests/fake-discord.mjs', record, '0', String(status)], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  sinks.push(proc);
  const port = await new Promise((resolve, reject) => {
    proc.stdout.once('data', (d) => resolve(Number(String(d).match(/listening (\d+)/)?.[1])));
    proc.once('exit', () => reject(new Error('sink exited early')));
  });
  const posts = () =>
    fs
      .readFileSync(record, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { url: `http://127.0.0.1:${port}/hook`, posts, stop: () => proc.kill('SIGTERM') };
}

/** A webhook that answers after 400 ms; resolves requestStarted on arrival. */
async function startSlowSink() {
  const http = await import('node:http');
  let started;
  const requestStarted = new Promise((r) => (started = r));
  const server = http.createServer((req, res) => {
    started();
    req.resume();
    setTimeout(() => {
      res.writeHead(204);
      res.end();
    }, 400);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/hook`,
    requestStarted,
    // closeAllConnections: a poster killed mid-request leaves its socket
    // open, and a plain close() would keep this test process alive.
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function runCli(args, env) {
  // Async so the sink in this same process can answer while the CLI waits.
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/crash-report.mjs', ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

{
  const sink = await startSink();
  const logDir = path.join(TMP, 'cli-logs');
  const logFile = path.join(TMP, 'next.log');
  const lines = [];
  for (let i = 1; i <= 80; i++) lines.push(`line ${i}`);
  lines.push('upstream call with Authorization: Bearer NOT-A-REAL-KEY-scrub-fixture');
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  const r = await runCli(['--title', 'Ember: Next crashed', '--text', 'exit code 1 <@123>', '--log', logFile, '--lines', '50'], {
    DISCORD_CRASH_WEBHOOK_URL: sink.url,
    EMBER_LOG_DIR: logDir,
  });
  check('CLI exits 0 on success', r.code === 0, r.stderr.trim());
  const [post] = sink.posts();
  check('one POST reached the webhook', sink.posts().length === 1);
  check('it is multipart', !!post && post.contentType.startsWith('multipart/form-data'));
  const parts = post ? parseMultipart(post) : [];
  const payloadPart = parts.find((p) => p.name === 'payload_json');
  const filePart = parts.find((p) => p.filename);
  const payload = payloadPart ? JSON.parse(payloadPart.content) : null;
  const embed = payload?.embeds?.[0];
  check('embed carries the title and text', embed?.title === 'Ember: Next crashed' && embed?.description.includes('exit code 1'));

  await runCli(['--title', 'Server error: fetch ?token=hunter2hunter2 failed', '--text', 'x'], {
    DISCORD_CRASH_WEBHOOK_URL: sink.url,
    EMBER_LOG_DIR: logDir,
  });
  const titled = sink.posts()[1];
  const titledEmbed = titled ? JSON.parse(parseMultipart(titled).find((p) => p.name === 'payload_json').content).embeds[0] : null;
  check('the title is scrubbed too', !!titledEmbed && !titledEmbed.title.includes('hunter2') && titledEmbed.title.includes('?token=[scrubbed]'), titledEmbed?.title);
  check('mentions are disabled', Array.isArray(payload?.allowed_mentions?.parse) && payload.allowed_mentions.parse.length === 0);
  check(
    'footer has hostname, git sha and time',
    typeof embed?.footer?.text === 'string' && embed.footer.text.includes(os.hostname()) && /\d{4}-\d{2}-\d{2}T/.test(embed.footer.text),
    embed?.footer?.text,
  );
  check('log tail attached as a file', filePart?.filename === 'next.log.txt');
  const tailLines = filePart ? filePart.content.split('\n') : [];
  check('tail is the last 50 lines only', tailLines.length === 50 && tailLines[0] === 'line 32', `${tailLines.length} lines, first "${tailLines[0]}"`);
  check(
    'bearer token in the tail is scrubbed',
    !!filePart && !filePart.content.includes('NOT-A-REAL-KEY-scrub-fixture') && filePart.content.includes('bearer [scrubbed]'),
  );
  check('rate-limit state written under EMBER_LOG_DIR', fs.existsSync(path.join(logDir, 'crash-report.state')));

  const empty = path.join(TMP, 'empty.log');
  fs.writeFileSync(empty, '');
  await runCli(['--title', 'no tail', '--text', 'x', '--log', empty], { DISCORD_CRASH_WEBHOOK_URL: sink.url, EMBER_LOG_DIR: logDir });
  const second = sink.posts()[2];
  check('an empty log attaches no file', !!second && !parseMultipart(second).some((p) => p.filename));
  sink.stop();
}

{
  const sink = await startSink(500);
  const r = await runCli(['--title', 't', '--text', 'x'], {
    DISCORD_CRASH_WEBHOOK_URL: sink.url,
    EMBER_LOG_DIR: path.join(TMP, 'fail-logs'),
  });
  check('a failing webhook still exits 0', r.code === 0);
  check('and says so in one stderr line', r.stderr.trim().split('\n').length === 1 && /500/.test(r.stderr), r.stderr.trim());
  sink.stop();

  const refused = await runCli(['--title', 't', '--text', 'x'], {
    DISCORD_CRASH_WEBHOOK_URL: 'http://127.0.0.1:9/nothing-listens',
    EMBER_LOG_DIR: path.join(TMP, 'fail-logs-2'),
  });
  check('an unreachable webhook exits 0 too', refused.code === 0 && refused.stderr.includes('crash-report:'), refused.stderr.trim());
}

{
  // Rate limit through the CLI: pre-fill the state so the next post is the mute notice.
  const sink = await startSink();
  const logDir = path.join(TMP, 'muted-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(
    path.join(logDir, 'crash-report.state'),
    JSON.stringify({ posts: Array.from({ length: RATE_LIMIT }, (_, i) => now - i * 1000), mutedAt: 0 }),
  );
  const env = { DISCORD_CRASH_WEBHOOK_URL: sink.url, EMBER_LOG_DIR: logDir };
  await runCli(['--title', 'eleventh', '--text', 'x'], env);
  await runCli(['--title', 'twelfth', '--text', 'x'], env);
  const posts = sink.posts();
  check('over the limit: exactly one post, the mute notice', posts.length === 1 && posts[0].body.includes('too many crash reports, muted for this hour'));
  check('the over-limit reports themselves are not sent', !posts.some((p) => p.body.includes('eleventh') || p.body.includes('twelfth')));
  sink.stop();
}

// A sanity check that importing the module never posts by itself.
// The poster outlives a closing terminal's SIGHUP (sent twice, 50 ms apart).
{
  // A slow webhook keeps the poster alive long enough to be signalled.
  const slow = await startSlowSink();
  const child = spawn(process.execPath, ['scripts/crash-report.mjs', '--title', 'hup', '--text', 'x'], {
    env: { PATH: process.env.PATH, DISCORD_CRASH_WEBHOOK_URL: slow.url, EMBER_LOG_DIR: path.join(TMP, 'hup-logs') },
    stdio: 'ignore',
  });
  // Listen before signalling: a poster killed by the first SIGHUP would
  // otherwise exit before anyone is listening, and this would hang.
  const exited = new Promise((r) => child.on('exit', (c, sig) => r(sig ?? c)));
  await slow.requestStarted;
  child.kill('SIGHUP');
  await new Promise((r) => setTimeout(r, 50));
  child.kill('SIGHUP');
  child.kill('SIGINT');
  const code = await exited;
  check('two SIGHUPs and a SIGINT mid-post do not kill the poster', code === 0, String(code));
  slow.stop();
}

{
  const r = spawnSync(process.execPath, ['-e', "import('./scripts/crash-report.mjs').then(() => console.log('ok'))"], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, DISCORD_CRASH_WEBHOOK_URL: 'http://127.0.0.1:9/x' },
  });
  check('importing the module does not run the CLI', r.status === 0 && r.stdout.trim() === 'ok' && r.stderr === '', r.stderr.trim());
}

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
