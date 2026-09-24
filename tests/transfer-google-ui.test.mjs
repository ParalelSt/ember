/** Transfer: YouTube Music likes after a Google sign-in, in a real browser,
 *  against a fake Google. Settings > Library > Transfer > Liked songs >
 *  YouTube Music > Sign in with Google > the code > the fake Google's device
 *  page says Allow > "Checking which likes are songs" > preview > Start >
 *  the Liked page shows the transfer. Two passes before the preview: the
 *  gaming like (category 20) is dropped at once, then YouTube Music (the
 *  fake player's `classify`, from fixtures/imports/ytm-classify.json) says
 *  which of the rest are songs. Official ones are in the preview and liked,
 *  uploads are counted to check and wait for a yes or no in the review
 *  sheet, and the rest (a Minecraft video YouTube files under "Music", a
 *  video whose lookup fails) never show anywhere and are only counted.
 *  Then the two other endings a person can reach: saying no on Google's page,
 *  and closing the dialog halfway.
 *
 *      node tests/transfer-google-ui.test.mjs
 *
 *  No Google account and no real credentials: this file serves its own fake
 *  Google (device/code, token, revoke, a device page with Allow and Deny,
 *  and videos?myRating=like) on FAKE_GOOGLE_PORT (8097), and the app is
 *  pointed at it with the base-URL overrides. Needs playwright-core and a
 *  Chromium (CHROME_PATH, or the Playwright cache), the sandbox PocketBase,
 *  and the app started with the fake player and the fake Google. Port 3050
 *  may be serving apps/web/.next, so build a scratch copy of apps/web (its
 *  node_modules symlinked) rather than rebuilding that .next, and start it
 *  on 3051:
 *
 *    cd <scratch copy of apps/web> && POCKETBASE_URL=http://127.0.0.1:8088 npx next build --webpack
 *    FAKE_CLASSIFY_SLEEP=3 POCKETBASE_URL=http://127.0.0.1:8088 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      GOOGLE_OAUTH_CLIENT_ID=fake-client.apps.googleusercontent.com \
 *      GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-fakeClientSecretForTests \
 *      GOOGLE_OAUTH_BASE=http://127.0.0.1:8097/oauth \
 *      YOUTUBE_API_BASE=http://127.0.0.1:8097/youtube/v3 \
 *      EMBER_LOG_DIR=/tmp/transfer-google-logs \
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug \
 *      DISCORD_FEATURE_WEBHOOK_URL=http://127.0.0.1:8099/feature \
 *      DISCORD_FIX_WEBHOOK_URL=http://127.0.0.1:8099/fix \
 *      npx next start -p 3051 &
 *    APP_URL=http://127.0.0.1:3051 EMBER_LOG_DIR=/tmp/transfer-google-logs FAKE_CLASSIFY_SLEEP=3 \
 *      FAKE_CLIENT_SECRET=GOCSPX-fakeClientSecretForTests node tests/transfer-google-ui.test.mjs
 *
 *  FAKE_CLASSIFY_SLEEP (seconds per `classify` call, the same for both) is
 *  what lets the browser catch the checking line; without it that one
 *  check is skipped.
 *
 *  The test makes its own throwaway user and deletes it afterwards; it
 *  writes nothing else. SHOT_DIR keeps screenshots. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync } from 'node:child_process';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3051';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 8097);
const LOG_DIR = process.env.EMBER_LOG_DIR ?? '';
const PW = 'TransferGoogleUi2026!';
const SHOTS = process.env.SHOT_DIR ?? '';

// ── The fake Google ──
// Tokens shaped like Google's, with a marker that must never reach the
// browser or the app's logs.
const MARK = 'FakeS3cr3t';
const ACCESS = `ya29.${MARK}Access`;
const REFRESH = `1//0${MARK}Refresh`;
const video = (id, title, channelTitle, categoryId = '10') => ({
  id,
  snippet: { title, channelTitle, categoryId, thumbnails: { high: { url: '' } } },
  contentDetails: { duration: 'PT3M21S' },
});
// What YouTube Music says about each is in fixtures/imports/ytm-classify.json.
const PAGES = [
  [
    video('gPaperLant1', 'Halcyon Drift - Paper Lanterns (Official Video)', 'HalcyonDriftVEVO'), // OMV
    video('gSpeedrun01', 'Any% speedrun, world record', 'Some Gamer', '20'), // Gaming: dropped by the first pass
    video('gNineStrt01', 'Nine Streets', 'The Quiet Parade - Topic', '10'), // Topic: never asked
  ],
  [
    video('gSlowWthr01', 'Slow Weather', 'Nadia Okonkwo - Topic', '24'), // Topic
    video('gMobFarm001', 'I Built a GIANT Mob Farm in Old Minecraft', 'HorseFridge', '10'), // "Music", but no type
    video('gGarageDmo1', 'Garage demo, first take', 'The Quiet Parade', '10'), // UGC: yes
    video('gSatireAd01', 'NEW Bricks and Minifigs Commercial (satire)', 'AFK Anthem', '10'), // UGC: no
    video('gBrokenVid1', 'A video whose lookup fails', 'Nobody', '10'), // the lookup raises
  ],
];

const google = { codes: new Map(), revoked: [], tokenPolls: 0, videoCalls: 0, bearerOk: true, secretOk: true };
let codeSeq = 0;

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => resolve(b));
  });
}
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const form = new URLSearchParams(await readBody(req));
  if (url.pathname === '/oauth/device/code' && req.method === 'POST') {
    codeSeq++;
    const userCode = `TEST-${String(1000 + codeSeq)}`;
    const deviceCode = `AH-1Ng${MARK}Device${codeSeq}`;
    google.codes.set(userCode, { deviceCode, answer: 'pending' });
    return send(res, 200, {
      device_code: deviceCode,
      user_code: userCode,
      verification_url: `http://127.0.0.1:${PORT}/device`,
      expires_in: 1800,
      interval: 1,
    });
  }
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    google.tokenPolls++;
    if (form.get('client_secret') !== process.env.FAKE_CLIENT_SECRET && process.env.FAKE_CLIENT_SECRET) google.secretOk = false;
    const entry = [...google.codes.values()].find((c) => c.deviceCode === form.get('device_code'));
    if (!entry) return send(res, 400, { error: 'invalid_grant' });
    if (entry.answer === 'pending') return send(res, 428, { error: 'authorization_pending' });
    if (entry.answer === 'deny') return send(res, 403, { error: 'access_denied' });
    entry.answer = 'used';
    return send(res, 200, {
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      token_type: 'Bearer',
    });
  }
  if (url.pathname === '/oauth/revoke' && req.method === 'POST') {
    google.revoked.push(form.get('token'));
    return send(res, 200, '');
  }
  if (url.pathname === '/youtube/v3/videos') {
    google.videoCalls++;
    if (req.headers.authorization !== `Bearer ${ACCESS}` || google.revoked.length) {
      google.bearerOk = false;
      return send(res, 401, { error: { code: 401, errors: [{ reason: 'authError' }] } });
    }
    if (url.searchParams.get('myRating') !== 'like') return send(res, 400, { error: { code: 400 } });
    const i = Number(url.searchParams.get('pageToken') ?? 0);
    return send(res, 200, { items: PAGES[i] ?? [], ...(i + 1 < PAGES.length ? { nextPageToken: String(i + 1) } : {}) });
  }
  // The page a person types the code on, standing in for google.com/device.
  if (url.pathname === '/device' && req.method === 'GET') {
    return send(
      res,
      200,
      `<!doctype html><title>Fake Google</title><form method="post" action="/device">
        <input name="code" aria-label="Enter code"><button name="answer" value="allow">Allow</button>
        <button name="answer" value="deny">Deny</button></form>`,
      'text/html',
    );
  }
  if (url.pathname === '/device' && req.method === 'POST') {
    const entry = google.codes.get(form.get('code')?.trim() ?? '');
    if (entry) entry.answer = form.get('answer') === 'deny' ? 'deny' : 'allow';
    return send(res, 200, `<!doctype html><p>${entry ? 'You can close this tab.' : 'Unknown code.'}</p>`, 'text/html');
  }
  send(res, 404, { error: 'not found' });
});
await new Promise((r) => fake.listen(PORT, '127.0.0.1', r));

// ── The test ──
const out = [];
const check = (name, pass, detail = '') => {
  out.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache: set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found: set CHROME_PATH');
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}

const tok = await adminToken();
const email = `transfer-google-ui-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
const userRec = await fetch(`${PB}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Transfer Google UI', verified: true }),
}).then((r) => r.json());
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PW }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

/** Titles of everything the throwaway user has liked, sorted. */
async function likedTitles() {
  const r = await fetch(
    `${PB}/api/collections/likes/records?perPage=200&expand=track&filter=${encodeURIComponent(`user = "${userRec.id}"`)}`,
    { headers: { Authorization: tok } },
  ).then((x) => x.json());
  return (r.items ?? []).map((l) => l.expand?.track?.title ?? '?').sort();
}

/** Lines of the fake player's call log for one command. */
const PLAYER_LOG = process.env.FAKE_PLAYER_LOG ?? '/tmp/fake-player.log';
function playerCalls(cmd) {
  if (!fs.existsSync(PLAYER_LOG)) return [];
  return fs.readFileSync(PLAYER_LOG, 'utf8').split('\n').filter((l) => l.startsWith(`${cmd} `));
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `transfer-google-ui-${name}.png`), fullPage: true });
};

async function openGoogleRoute(page) {
  await page.goto(`${APP}/settings/library`, { waitUntil: 'networkidle' });
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForSelector('[data-testid="transfer-dialog"]');
  await page.click('[data-testid="transfer-destination-card"][data-destination="liked"]');
  await page.click('[data-testid="transfer-service-card"][data-service="ytmusic"]');
  await page.click('[data-testid="transfer-have-option"][data-route="ytmusic-google"]');
  await page.getByRole('button', { name: /Sign in with Google/ }).waitFor();
}

/** Type the code on the fake Google's page, opened from the dialog's link
 *  the way a person would, and press Allow or Deny. */
async function answerOnGoogle(page, answer) {
  const userCode = (await page.textContent('[data-testid="google-user-code"]'))?.trim() ?? '';
  const [google_] = await Promise.all([page.context().waitForEvent('page'), page.click('[data-testid="google-verification-link"]')]);
  await google_.waitForLoadState();
  await google_.fill('[aria-label="Enter code"]', userCode);
  await google_.click(`button[value="${answer}"]`);
  await google_.waitForLoadState();
  await google_.close();
  return userCode;
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const seen = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const consoleLeaks = [];
  page.on('console', (m) => { if (m.text().includes(MARK)) consoleLeaks.push(m.text()); });
  // Every answer the app gave the browser, to prove no token was in one.
  page.on('response', async (r) => {
    if (!r.url().startsWith(APP)) return;
    try { seen.push(`${r.url()}\n${await r.text()}`); } catch { /* a navigation body */ }
  });

  // ── A. The way in ──
  await page.goto(`${APP}/settings/library`, { waitUntil: 'networkidle' });
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForSelector('[data-testid="transfer-dialog"]');
  await page.click('[data-testid="transfer-destination-card"][data-destination="liked"]');
  await page.click('[data-testid="transfer-service-card"][data-service="ytmusic"]');
  const options = await page.$$eval('[data-testid="transfer-have-option"]', (els) => els.map((e) => e.textContent));
  check('A1 signing in is the first answer for YouTube Music likes', options[0] === 'I can sign in to my Google account', JSON.stringify(options));
  await page.click('[data-testid="transfer-have-option"][data-route="ytmusic-google"]');
  const signIn = page.getByRole('button', { name: /Sign in with Google/ });
  await signIn.waitFor();
  const stepsText = (await page.textContent('[data-testid="transfer-dialog"]')) ?? '';
  check('A2 the steps name google.com/device and say Ember forgets it', /google\.com\/device/.test(stepsText) && /signs itself out/.test(stepsText));
  check('A3 nothing about developer tools or headers anywhere', !/F12|developer tools|request headers/i.test(stepsText));
  await shot(page, 'steps');

  // ── B. Sign in with Google: the code, the link, the wait ──
  await signIn.click();
  await page.waitForSelector('[data-testid="google-user-code"]', { timeout: 10_000 });
  const code = (await page.textContent('[data-testid="google-user-code"]'))?.trim() ?? '';
  check('B1 the code is on screen', /^TEST-\d{4}$/.test(code), code);
  const href = await page.getAttribute('[data-testid="google-verification-link"]', 'href');
  check('B2 with a link to the page Google named, in a new tab', href === `http://127.0.0.1:${PORT}/device` &&
    (await page.getAttribute('[data-testid="google-verification-link"]', 'target')) === '_blank', href ?? '');
  check('B3 and a waiting line', /Waiting for you to allow Ember/.test((await page.textContent('[data-testid="google-waiting"]')) ?? ''));
  await shot(page, 'code');

  // ── C. The fake Google says Allow; YouTube Music checks; the preview arrives ──
  const classifyCallsBefore = playerCalls('classify').length;
  await answerOnGoogle(page, 'allow');
  if (process.env.FAKE_CLASSIFY_SLEEP) {
    const line = await page
      .waitForFunction(
        () => /Checking which likes are songs: \d+ of \d+/.test(document.querySelector('[data-testid="google-waiting"]')?.textContent ?? ''),
        null,
        { timeout: 20_000 },
      )
      .then(() => page.textContent('[data-testid="google-waiting"]'))
      .catch(() => '');
    check('C0 while YouTube Music checks, the dialog says how far it is', /^Checking which likes are songs: \d of 5$/.test(line ?? ''), line ?? '');
  } else {
    console.log('SKIP  C0 the checking line: start the server and this test with FAKE_CLASSIFY_SLEEP=3');
  }
  await page.waitForSelector('[data-testid="transfer-preview"]', { timeout: 30_000 });
  const preview = (await page.textContent('[data-testid="transfer-preview"]')) ?? '';
  check('C1 the preview names the source and counts only the songs', /Liked songs from YouTube Music/.test(preview) && /3 songs/.test(preview), preview);
  check('C2 newest first, with the music video title cleaned up', /Paper Lanterns, Halcyon Drift/.test(preview), preview);
  const dialogText = (await page.textContent('[data-testid="transfer-dialog"]')) ?? '';
  check('C3 no gaming video, no "Music" Minecraft video, no failed lookup, no upload named in the preview',
    !/speedrun|Mob Farm|lookup fails|Garage demo|Bricks and Minifigs/.test(dialogText), dialogText);
  const toCheck = (await page.textContent('[data-testid="google-to-check"]')) ?? '';
  check('C4 the two uploads are counted as needing a quick check', toCheck === '2 more need a quick check: uploads YouTube Music is not sure are songs.', toCheck);
  check('C5 the token was revoked the moment the likes were read', google.revoked.includes(REFRESH), JSON.stringify(google.revoked.length));
  check('C6 the likes were read with the token, before it was revoked, and the secret was sent', google.bearerOk && google.secretOk && google.videoCalls === 2);
  const calls = playerCalls('classify').length - classifyCallsBefore;
  const asked = playerCalls('classify-ids').slice(-1)[0] ?? '';
  check('C7 YouTube Music was asked once, before the preview, never about a Topic channel or the gaming like',
    calls === 1 && /gMobFarm001/.test(asked) && !/gNineStrt01|gSlowWthr01|gSpeedrun01/.test(asked), `${calls} call(s): ${asked}`);
  await shot(page, 'preview');

  // ── D. Start, and the Liked page takes over ──
  const start = page.getByRole('button', { name: /^Transfer 5 songs$/ });
  check('D1 Start counts the songs and the uploads', (await start.count()) === 1 && !(await start.isDisabled()));
  const classifyCallsAtStart = playerCalls('classify').length;
  await start.click();
  await page.waitForURL('**/library/liked', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="transfer-result"]', { timeout: 60_000 });
  const result = (await page.textContent('[data-testid="transfer-result"]')) ?? '';
  check('D2 the summary says it in plain words', result === 'We found 3 songs. 2 need a quick check. 2 likes were not music.', result);
  const likedNow = await likedTitles();
  check('D3 only the official songs were liked', JSON.stringify(likedNow) === JSON.stringify(['Nine Streets', 'Paper Lanterns', 'Slow Weather']),
    JSON.stringify(likedNow));
  const toSort = (await page.textContent('[data-testid="transferring-block"]')) ?? '';
  check('D4 the two uploads wait under "Still to sort out", the rest are nowhere',
    /Still to sort out/.test(toSort) && /Garage demo/.test(toSort) && /Bricks and Minifigs/.test(toSort) &&
      !/speedrun|Mob Farm|lookup fails/.test((await page.textContent('body')) ?? ''), toSort);
  check('D5 the transfer itself asked YouTube Music nothing more', playerCalls('classify').length === classifyCallsAtStart,
    `${playerCalls('classify').length - classifyCallsAtStart} more call(s)`);
  await shot(page, 'liked');

  // ── D6. The quick check: yes to the demo, no to the satire ad ──
  await page.locator('[data-testid="import-summary"]').getByRole('button', { name: /Review/ }).click();
  await page.waitForSelector('[data-testid="review-sheet"]');
  const first = (await page.textContent('[data-testid="review-source"]')) ?? '';
  check('D6 the sheet asks whether the upload is a song', /Garage demo/.test(first) && /Is this a song\?/.test(first), first);
  await shot(page, 'review');
  await page.getByRole('button', { name: 'Use best match' }).click();
  await page.waitForFunction(() => /Bricks and Minifigs/.test(document.querySelector('[data-testid="review-source"]')?.textContent ?? ''), null, { timeout: 10_000 });
  await page.getByRole('button', { name: /Remove song/ }).click();
  await page.waitForSelector('[data-testid="review-done"]', { timeout: 10_000 });
  await page.locator('[data-testid="review-sheet"]').getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="transfer-result"]')?.textContent === 'We found 4 songs. 3 likes were not music.',
    null,
    { timeout: 15_000 },
  ).catch(() => {});
  const after = (await page.textContent('[data-testid="transfer-result"]')) ?? '';
  check('D7 a yes likes the upload, a no counts it as not music', after === 'We found 4 songs. 3 likes were not music.', after);
  const likedAfter = await likedTitles();
  check('D8 and the likes now hold the demo, not the ad', likedAfter.includes('Garage demo, first take') && !likedAfter.some((t) => /Bricks/.test(t)),
    JSON.stringify(likedAfter));

  // ── E. Saying no on Google's page ──
  await openGoogleRoute(page);
  await page.getByRole('button', { name: /Sign in with Google/ }).click();
  await page.waitForSelector('[data-testid="google-user-code"]');
  const revokedBefore = google.revoked.length;
  await answerOnGoogle(page, 'deny');
  await page.waitForSelector('[data-testid="transfer-error"]', { timeout: 20_000 });
  const denied = (await page.textContent('[data-testid="transfer-error"]')) ?? '';
  check('E1 a no is one plain sentence', denied === "You said no on Google's page, so nothing was read.", denied);
  check('E2 the button is back for another go', await page.getByRole('button', { name: /Sign in with Google/ }).isEnabled());
  check('E3 and there was no token to revoke', google.revoked.length === revokedBefore);

  // ── F. Closing the dialog halfway stops the server asking Google ──
  const pollsBefore = google.tokenPolls;
  await page.getByRole('button', { name: /Sign in with Google/ }).click();
  await page.waitForSelector('[data-testid="google-user-code"]');
  // Let the server ask Google a couple of times first, so there is polling
  // to stop.
  const deadline = Date.now() + 10_000;
  while (google.tokenPolls < pollsBefore + 2 && Date.now() < deadline) await page.waitForTimeout(200);
  check('F0 while the code is up, the server is asking Google', google.tokenPolls >= pollsBefore + 2);
  await page.getByRole('button', { name: /^Cancel$/ }).click();
  await page.waitForSelector('[data-testid="transfer-dialog"]', { state: 'detached' });
  await page.waitForTimeout(1_500);
  const pollsAfterClose = google.tokenPolls;
  await page.waitForTimeout(3_000);
  check('F1 once the dialog closes, nobody polls Google for that code again', google.tokenPolls === pollsAfterClose,
    `${pollsAfterClose} then ${google.tokenPolls}`);

  // ── G. Nothing secret ever left the server ──
  // By value: the app's own scripts carry the redaction patterns, so the
  // shapes alone would match its JavaScript.
  const CLIENT_SECRET = process.env.FAKE_CLIENT_SECRET ?? 'GOCSPX-fakeClientSecretForTests';
  const leaked = seen.filter((t) => t.includes(MARK) || t.includes(CLIENT_SECRET));
  check('G1 no response the browser got carried a token, device code or client secret', seen.length > 10 && leaked.length === 0,
    `${seen.length} responses, ${leaked.length} leaks${leaked.length ? `: ${leaked.map((t) => t.split('\n')[0]).join(', ')}` : ''}`);
  check('G2 no console message carried one', consoleLeaks.length === 0, consoleLeaks.join(' | '));
  if (LOG_DIR) {
    const logs = fs.existsSync(LOG_DIR)
      ? fs.readdirSync(LOG_DIR).map((f) => fs.readFileSync(path.join(LOG_DIR, f), 'utf8')).join('\n')
      : '';
    check('G3 and the server log holds none either', !logs.includes(MARK) && !logs.includes(CLIENT_SECRET), `${logs.length} bytes of log`);
  } else {
    console.log('SKIP  G3 the server log: set EMBER_LOG_DIR to the one the server writes to');
  }

  check('H1 no page errors anywhere in the flow', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  fake.close();
  if (userRec?.id) {
    await fetch(`${PB}/api/collections/users/records/${userRec.id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((p) => !p).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
