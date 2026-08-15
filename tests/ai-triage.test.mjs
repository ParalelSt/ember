/** End-to-end test for AI triage of bug reports.
 *
 *  Drives the real /api/bug-report route against a fake Anthropic API and a
 *  fake Discord webhook, so it needs no API key and posts nothing anywhere.
 *
 *  Setup (see tests/README.md for the copy-paste version): a sandbox
 *  PocketBase, one Next server WITH a key, one WITHOUT.
 *
 *      node tests/ai-triage.test.mjs
 *
 *  Env overrides: PB_URL, APP_URL, APP_NOKEY_URL, PB_ADMIN_EMAIL,
 *  PB_ADMIN_PASSWORD, FAKE_ANTHROPIC_PORT, FAKE_DISCORD_PORT.
 *
 *  The servers under test must run with:
 *      ANTHROPIC_API_KEY=test-key
 *      ANTHROPIC_BASE_URL=http://127.0.0.1:<FAKE_ANTHROPIC_PORT>
 *      BUG_TRIAGE_MODEL=claude-sonnet-5
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:<FAKE_DISCORD_PORT>/hook
 *  …and the no-key server with an empty ANTHROPIC_API_KEY. */
import http from 'node:http';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const APP_NOKEY_URL = process.env.APP_NOKEY_URL ?? 'http://127.0.0.1:3006';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const ANTHROPIC_PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 4311);
const DISCORD_PORT = Number(process.env.FAKE_DISCORD_PORT ?? 4312);

// One user per case: the route rate-limits to one report per user per 30s, and
// separate users keep the suite sleep-free.
const USER_PASSWORD = 'BugTest2026!';
const USERS = 6;

// ── fakes ─────────────────────────────────────────────────────────────────
let anthropicMode = 'ok';
const anthropicSeen = [];
const discordSeen = [];

const TRIAGE = {
  summary: 'Playback stops a few seconds into every track.',
  likelyCause: 'The stream proxy returns 403 from YouTube on expired URLs; the client retries and gives up.',
  area: 'streaming',
  severity: 'high',
  confidence: 'high',
  nextSteps: ['Check yt-dlp version', 'Verify cookies.txt path'],
};

const reply = (text) => ({ content: [{ type: 'text', text }] });

const anthropic = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    anthropicSeen.push({ headers: req.headers, body: JSON.parse(body || '{}') });
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    switch (anthropicMode) {
      case 'fenced':
        return send(200, reply('Here you go:\n```json\n' + JSON.stringify({ ...TRIAGE, severity: 'low' }) + '\n```\nHope that helps.'));
      case 'http500':
        return send(500, { error: { message: 'overloaded' } });
      case 'garbage':
        return send(200, reply("I couldn't analyse that, sorry."));
      case 'badschema':
        return send(200, reply(JSON.stringify({ likelyCause: 'missing every other field' })));
      default:
        return send(200, reply(JSON.stringify(TRIAGE)));
    }
  });
});

const discord = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    discordSeen.push(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(204);
    res.end();
  });
});

// ── helpers ───────────────────────────────────────────────────────────────
async function adminToken() {
  // PB 0.22 uses /api/admins; 0.23+ uses /api/collections/_superusers.
  for (const path of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin — is the sandbox PB running?');
}

async function ensureUsers() {
  const token = await adminToken();
  for (let i = 1; i <= USERS; i++) {
    await fetch(`${PB_URL}/api/collections/users/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: token },
      body: JSON.stringify({
        email: `bugtest${i}@ember.test`,
        password: USER_PASSWORD,
        passwordConfirm: USER_PASSWORD,
        name: `Bug Tester ${i}`,
        verified: true,
      }),
    }); // Already exists → 400, which is fine.
  }
}

async function authCookie(n) {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: `bugtest${n}@ember.test`, password: USER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`auth failed for bugtest${n}: ${res.status}`);
  const { token, record } = await res.json();
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token, record }))}`;
}

/** A stuck retry loop (tests dedupe) plus one rare error buried under noise
 *  (tests that the cap keeps the signal). */
function noisySnapshot() {
  const now = Date.now();
  const current = [];
  for (let i = 0; i < 300; i++) {
    current.push({ ts: now - (300 - i) * 1000, kind: 'breadcrumb', level: 'info',
      category: 'route', message: 'navigate /search', sessionId: 'sess-test' });
  }
  for (let i = 0; i < 40; i++) {
    current.push({ ts: now - (40 - i) * 500, kind: 'error', level: 'error', category: 'audio',
      message: 'stream 403 for videoId=dQw4w9WgXcQ',
      data: { status: 403, videoId: 'dQw4w9WgXcQ' },
      stack: 'Error: stream 403\n  at play (player.tsx:44)\n  at onEnded (queue.ts:12)\n  at tick (loop.ts:9)',
      sessionId: 'sess-test' });
  }
  current.push({ ts: now - 200, kind: 'error', level: 'error', category: 'python',
    message: 'UNIQUE_MARKER yt-dlp exited 1: unable to extract player response', sessionId: 'sess-test' });
  return {
    current,
    previous: [{ ts: now - 90_000, kind: 'error', level: 'error', category: 'api',
      message: 'POST /api/likes → 500', sessionId: 'sess-old' }],
    sessionId: 'sess-test',
  };
}

/** 30 distinct errors under 400 breadcrumbs — proves the digest condenses
 *  noise without flattening real signal. */
function distinctSnapshot() {
  const now = Date.now();
  const current = [];
  for (let i = 0; i < 400; i++) {
    current.push({ ts: now - (500 - i) * 100, kind: 'breadcrumb', level: 'info',
      category: 'route', message: `navigate /page-${i % 7}`, sessionId: 's' });
  }
  for (let i = 0; i < 30; i++) {
    current.push({ ts: now - (30 - i) * 200, kind: 'error', level: 'error', category: 'api',
      message: `DISTINCT_ERR_${i} something specific failed`, sessionId: 's' });
  }
  current.sort((a, b) => a.ts - b.ts);
  return { current, previous: [], sessionId: 's' };
}

async function report(app, cookie, note, client = noisySnapshot()) {
  const res = await fetch(`${app}/api/bug-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'user-agent': 'EmberTest/1.0' },
    body: JSON.stringify({ note, client }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ── run ───────────────────────────────────────────────────────────────────
await new Promise((r) => anthropic.listen(ANTHROPIC_PORT, '127.0.0.1', r));
await new Promise((r) => discord.listen(DISCORD_PORT, '127.0.0.1', r));
await ensureUsers();

// A. happy path
anthropicMode = 'ok';
const cookie1 = await authCookie(1);
const a = await report(APP_URL, cookie1, 'Songs cut out after a few seconds');
check('A1 report accepted', a.status === 200 && a.json?.ok === true, `status ${a.status}`);
check('A2 triage returned to the reporter', a.json?.triage?.severity === 'high' && a.json?.triage?.area === 'streaming');

const call = anthropicSeen.at(-1);
const prompt = call?.body?.messages?.[0]?.content ?? '';
check('A3 Anthropic called exactly once', anthropicSeen.length === 1, `${anthropicSeen.length} calls`);
check('A4 key + version headers sent',
  call?.headers['x-api-key'] === 'test-key' && call?.headers['anthropic-version'] === '2023-06-01');
check('A5 model override honoured', call?.body?.model === 'claude-sonnet-5', call?.body?.model);
check('A6 reporter note reaches the prompt', prompt.includes('Songs cut out after a few seconds'));
check('A7 rare error survives the cap', prompt.includes('UNIQUE_MARKER'));
check('A8 repeated lines collapsed', /\(x\d+\)/.test(prompt));
check('A9 digest bounded', prompt.length < 20_000, `${prompt.length} chars from 341 events`);
check('A10 previous session included', prompt.includes('POST /api/likes'));

const embed = discordSeen.at(-1) ?? '';
check('B1 Discord received the report', discordSeen.length === 1);
check('B2 embed leads with the AI summary', embed.includes('Playback stops a few seconds'));
check('B3 embed carries the likely cause', embed.includes('Likely cause'));
check('B4 embed carries next steps', embed.includes('Check yt-dlp version'));
check('B5 severity colours the embed', embed.includes(String(0xef4444)), 'high → red');
check('B6 raw report still attached', embed.includes('report.json') && embed.includes('dQw4w9WgXcQ'));
check('B7 triage stored in the attachment', embed.includes('"triage"'));

// C. model wraps its JSON in prose/fences
anthropicMode = 'fenced';
const c = await report(APP_URL, await authCookie(2), 'weird thing happened');
check('C1 fenced JSON parsed', c.json?.triage?.severity === 'low', String(c.json?.triage?.severity));
check('C2 low severity colours green', (discordSeen.at(-1) ?? '').includes(String(0x4ade80)));

// D. every AI failure mode must still deliver the report
anthropicMode = 'http500';
const d1 = await report(APP_URL, await authCookie(3), 'api down case');
check('D1 HTTP 500 → report still sent', d1.status === 200 && d1.json?.ok === true);
check('D2 HTTP 500 → triage null', d1.json?.triage === null);
check('D3 HTTP 500 → default embed colour', (discordSeen.at(-1) ?? '').includes(String(0xff5a3a)));
check('D4 HTTP 500 → note still delivered', (discordSeen.at(-1) ?? '').includes('api down case'));

anthropicMode = 'garbage';
const d2 = await report(APP_URL, await authCookie(4), 'garbage reply case');
check('D5 non-JSON reply → report sent, triage null', d2.json?.ok === true && d2.json?.triage === null);

anthropicMode = 'badschema';
const d3 = await report(APP_URL, await authCookie(5), 'bad schema case');
check('D6 schema mismatch → report sent, triage null', d3.json?.ok === true && d3.json?.triage === null);

// E. no API key — the behaviour every deployment without a key gets
const before = anthropicSeen.length;
const e = await report(APP_NOKEY_URL, cookie1, 'no key configured');
check('E1 no key → report still sent', e.status === 200 && e.json?.ok === true);
check('E2 no key → triage null', e.json?.triage === null);
check('E3 no key → Anthropic never called', anthropicSeen.length === before);
check('E4 no key → Discord still got it', (discordSeen.at(-1) ?? '').includes('no key configured'));

// F. rate limit unchanged by the new work
anthropicMode = 'ok';
const f = await report(APP_URL, cookie1, 'second report from same user');
check('F1 second report inside 30s blocked', f.status === 429, `status ${f.status}`);

// G. noise is condensed, signal is not
const g = await report(APP_URL, await authCookie(6), 'distinct events check', distinctSnapshot());
const gPrompt = anthropicSeen.at(-1)?.body?.messages?.[0]?.content ?? '';
const missing = [];
for (let i = 0; i < 30; i++) if (!gPrompt.includes(`DISTINCT_ERR_${i} `)) missing.push(i);
check('G1 report accepted', g.json?.ok === true);
check('G2 all 30 distinct errors survive', missing.length === 0, missing.length ? `missing ${missing.join(',')}` : '30/30');
check('G3 400 breadcrumbs trimmed', (gPrompt.match(/navigate \/page-/g) ?? []).length <= 60,
  `${(gPrompt.match(/navigate \/page-/g) ?? []).length} kept`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));

anthropic.close();
discord.close();
process.exit(failed.length ? 1 : 0);
