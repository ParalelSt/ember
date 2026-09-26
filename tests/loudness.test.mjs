/** Volume normalization, server side, against a running app.
 *
 *      node tests/loudness.test.mjs      # or: npm run test:loudness
 *
 *  A downloaded song is measured once in the background and its gain is
 *  served by /api/tracks/<id>/loudness; a song downloaded before this existed
 *  is measured the first time anyone asks. Uses tests/fake-player.sh (its
 *  `loudness` command writes FAKE_GAIN_DB, default -3), so no yt-dlp, no
 *  ffmpeg and no network. The real measurement is covered by
 *  tests/test_loudness.py. Start a sandbox server with:
 *
 *      STREAM_MODE= \
 *      PYTHON_BIN=/bin/bash \
 *      PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      MUSIC_DIR=/tmp/ember-loudness-test/music \
 *      FAKE_PLAYER_LOG=/tmp/ember-loudness-test/calls.log \
 *      FAKE_DOWNLOAD_SECONDS=0 \
 *      npx next start -p 3060        # from apps/web
 */
import fs from 'node:fs';
import path from 'node:path';
import { memberCookie } from './sandbox-member.mjs';

const APP = process.env.LOUDNESS_APP_URL ?? 'http://127.0.0.1:3060';
const LOG = process.env.FAKE_PLAYER_LOG ?? '/tmp/ember-loudness-test/calls.log';
const MUSIC = process.env.MUSIC_DIR ?? '/tmp/ember-loudness-test/music';
const FRESH = 'loudfresh01';
const OLD = 'loudoldfile';
const MISSING = 'loudmissing';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const calls = (cmd, id) =>
  (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '').split('\n').filter((l) => l === `${cmd} ${id}`).length;
const gain = async (id) => {
  const res = await fetch(`${APP}/api/tracks/${encodeURIComponent(id)}/loudness`);
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
};
const waitForGain = async (id, ms = 10_000) => {
  const until = Date.now() + ms;
  for (;;) {
    const r = await gain(id);
    if (r.body.gainDb !== null || Date.now() > until) return r;
    await new Promise((res) => setTimeout(res, 200));
  }
};

// ── a song that was never downloaded: null, and nothing runs ─────────────
const none = await gain(`youtube:${MISSING}`);
check('A1 unknown song answers 200', none.status === 200, `status ${none.status}`);
check('A2 with a null gain', none.body.gainDb === null, JSON.stringify(none.body));
check('A3 not cacheable', none.cache === 'no-store', none.cache ?? 'none');
await new Promise((r) => setTimeout(r, 500));
check('A4 no measurement for a song that is not on disk', calls('loudness', MISSING) === 0);

// ── a fresh download is measured in the background ────────────────────────
// Songs not on disk are fetched for members only (security audit M2).
const cookie = await memberCookie({ label: 'loudness' });
const play = await fetch(`${APP}/api/youtube/stream/${FRESH}`, { headers: { cookie } });
await play.arrayBuffer();
check('B1 the song plays', play.status === 200, `status ${play.status}`);
const fresh = await waitForGain(`youtube:${FRESH}`);
check('B2 its gain appears without anyone asking for a measurement', fresh.body.gainDb === -3, JSON.stringify(fresh.body));
check('B3 a measured gain is cacheable', /max-age/.test(fresh.cache ?? ''), fresh.cache ?? 'none');
check('B4 the sidecar sits beside the audio', fs.existsSync(path.join(MUSIC, `${FRESH}.loudness.json`)));
await gain(`youtube:${FRESH}`);
await fetch(`${APP}/api/youtube/stream/${FRESH}`, { headers: { cookie } }).then((r) => r.arrayBuffer());
check('B5 measured exactly once', calls('loudness', FRESH) === 1, `${calls('loudness', FRESH)} run(s)`);

// ── a song downloaded before this existed is measured when first asked ────
fs.mkdirSync(MUSIC, { recursive: true });
fs.writeFileSync(path.join(MUSIC, `${OLD}.m4a`), `FAKE-AUDIO-${OLD}`);
const firstAsk = await gain(`youtube:${OLD}`);
check('C1 first ask: not measured yet', firstAsk.body.gainDb === null, JSON.stringify(firstAsk.body));
const later = await waitForGain(`youtube:${OLD}`);
check('C2 a moment later it is', later.body.gainDb === -3, JSON.stringify(later.body));
check('C3 still only one measurement', calls('loudness', OLD) === 1, `${calls('loudness', OLD)} run(s)`);

// ── anything that is not a YouTube song ───────────────────────────────────
const upload = await gain('upload:abc123');
check('D1 an upload has no gain', upload.status === 200 && upload.body.gainDb === null, JSON.stringify(upload.body));
const bad = await gain('youtube:../../etc');
check('D2 a malformed id has no gain', bad.body.gainDb === null, JSON.stringify(bad.body));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
