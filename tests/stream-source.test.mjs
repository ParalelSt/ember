/** Where does audio actually come from?
 *
 *      node tests/stream-source.test.mjs      # or: npm run test:stream
 *
 *  The rule this locks in: **the downloaded file is the source of truth.** A
 *  song is fetched once with yt-dlp and served off disk forever after, so
 *  playback never depends on a signed googlevideo URL staying valid — which is
 *  what produced the 403s, especially in the native apps.
 *
 *  Uses tests/fake-player.sh instead of the real player.py, so there's no
 *  yt-dlp and no network. Start a sandbox server with:
 *
 *      STREAM_MODE= \
 *      PYTHON_BIN=/bin/bash \
 *      PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      MUSIC_DIR=/tmp/ember-stream-test/music \
 *      FAKE_PLAYER_LOG=/tmp/ember-stream-test/calls.log \
 *      npx next start -p 3008
 */
import fs from 'node:fs';

const APP = process.env.STREAM_APP_URL ?? 'http://127.0.0.1:3008';
const LOG = process.env.FAKE_PLAYER_LOG ?? '/tmp/ember-stream-test/calls.log';
const VIDEO = process.env.STREAM_VIDEO_ID ?? 'aaaaaaaaaaa';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const calls = (cmd) => {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter((l) => l.startsWith(`${cmd} `));
};

const stream = (id, headers = {}) => fetch(`${APP}/api/youtube/stream/${id}`, { headers });

// ── one play of an uncached song downloads it, then serves the file ───────
const first = await stream(VIDEO);
const firstBody = Buffer.from(await first.arrayBuffer());
check('A1 uncached track plays', first.status === 200, `status ${first.status}`);
check('A2 served the downloaded bytes', firstBody.toString() === `FAKE-AUDIO-${VIDEO}`, firstBody.toString().slice(0, 40));
check('A3 it downloaded exactly once', calls('download').length === 1, `${calls('download').length} download(s)`);
check('A4 it never resolved a live stream URL', calls('info').length === 0,
  `${calls('info').length} info call(s) — proxying would mean 403 exposure`);

// ── a second play touches yt-dlp not at all ───────────────────────────────
const second = await stream(VIDEO);
await second.arrayBuffer();
check('B1 replay serves from disk', second.status === 200);
check('B2 no second download', calls('download').length === 1, `${calls('download').length} total`);

// ── concurrent requests for a NEW song share one download ─────────────────
// This is the case that matters for native players: they open several
// byte-range connections for one song, which without deduping would spawn a
// yt-dlp per connection, all racing to write the same file.
const CONCURRENT = 'bbbbbbbbbbb';
const before = calls('download').length;
const parallel = await Promise.all([
  stream(CONCURRENT),
  stream(CONCURRENT, { range: 'bytes=0-4' }),
  stream(CONCURRENT),
  stream(CONCURRENT, { range: 'bytes=5-' }),
]);
const bodies = await Promise.all(parallel.map((r) => r.arrayBuffer()));
const spawned = calls('download').length - before;
check('C1 all concurrent requests succeed',
  parallel.every((r) => r.status === 200 || r.status === 206),
  parallel.map((r) => r.status).join(','));
check('C2 four simultaneous requests → ONE download', spawned === 1, `${spawned} spawned`);
check('C3 range requests get a partial, not the whole file',
  parallel.some((r) => r.status === 206),
  parallel.map((r) => r.status).join(','));
const full = parallel.findIndex((r) => r.status === 200);
check('C4 the full response is the real audio',
  full !== -1 && Buffer.from(bodies[full]).toString() === `FAKE-AUDIO-${CONCURRENT}`,
  full === -1 ? 'no 200 response at all' : '');

// ── never serve a half-written file ───────────────────────────────────────
// yt-dlp renames the final filename into place and THEN post-processes it, so
// `<id>.m4a` can exist while still being written. Serving it in that window
// gave the player a truncated file: the decoder starved and playback sat
// frozen at 0:00 with no error — an intermittent "song won't play".
const PARTIAL = 'ddddddddddd';
const partialRuns = await Promise.all([
  stream(PARTIAL),
  new Promise((r) => setTimeout(r, 700)).then(() => stream(PARTIAL)),  // mid-download
  new Promise((r) => setTimeout(r, 1400)).then(() => stream(PARTIAL)),
]);
const partialBodies = await Promise.all(partialRuns.map((r) => r.arrayBuffer()));
const texts = partialBodies.map((b) => Buffer.from(b).toString());
check('E1 requests during a download all get the COMPLETE file',
  texts.every((t) => t === `FAKE-AUDIO-${PARTIAL}`),
  texts.map((t) => t.slice(0, 20)).join(' | '));
check('E2 still only one download for them', calls('download').filter((l) => l.includes(PARTIAL)).length === 1,
  `${calls('download').filter((l) => l.includes(PARTIAL)).length}`);

// ── the file really is on disk afterwards ─────────────────────────────────
const musicDir = process.env.MUSIC_DIR ?? '/tmp/ember-stream-test/music';
check('D1 audio persisted to MUSIC_DIR',
  fs.existsSync(`${musicDir}/${VIDEO}.m4a`) && fs.existsSync(`${musicDir}/${CONCURRENT}.m4a`),
  fs.existsSync(musicDir) ? fs.readdirSync(musicDir).join(', ') : 'missing');

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
