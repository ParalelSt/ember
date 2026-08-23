/** A failed download must NOT mean silence.
 *
 *      node tests/stream-fallback.test.mjs   # or: npm run test:stream-fallback
 *
 *  Real incident this covers: the host's yt-dlp went stale, YouTube started
 *  403ing its DOWNLOADER while URL resolution kept working, and because
 *  downloads are the primary source the app simply stopped playing anything
 *  uncached. Now a download failure falls through to live streaming.
 *
 *  Its own server, with a fake player rigged to fail downloads:
 *
 *      STREAM_MODE= PYTHON_BIN=/bin/bash \
 *      PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      FAKE_FAIL_DOWNLOAD=1 FAKE_STREAM_URL=http://127.0.0.1:4455/audio \
 *      MUSIC_DIR=/tmp/ember-fallback-test/music \
 *      FAKE_PLAYER_LOG=/tmp/ember-fallback-test/calls.log \
 *      STREAM_CACHE_WARM=0 npx next start -p 3009
 */
import http from 'node:http';
import fs from 'node:fs';

const APP = process.env.STREAM_APP_URL ?? 'http://127.0.0.1:3009';
const LOG = process.env.FAKE_PLAYER_LOG ?? '/tmp/ember-fallback-test/calls.log';
const ORIGIN_PORT = Number(process.env.FAKE_ORIGIN_PORT ?? 4455);
const VIDEO = 'ccccccccccc';
const AUDIO = Buffer.from('LIVE-STREAMED-AUDIO-BYTES');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const calls = (cmd) =>
  fs.existsSync(LOG)
    ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter((l) => l.startsWith(`${cmd} `))
    : [];

// Stand-in for googlevideo: serves bytes, like the real one still does when
// only yt-dlp's downloader is being refused.
const origin = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(AUDIO.length) });
  res.end(AUDIO);
});
await new Promise((r) => origin.listen(ORIGIN_PORT, '127.0.0.1', r));

const res = await fetch(`${APP}/api/youtube/stream/${VIDEO}`);
const body = Buffer.from(await res.arrayBuffer());

check('A1 playback still works when the download 403s', res.status === 200, `status ${res.status}`);
check('A2 the audio came from the live stream', body.equals(AUDIO), body.toString().slice(0, 40));
check('A3 it tried the download first', calls('download').length >= 1, `${calls('download').length}`);
check('A4 then fell back to resolving a live URL', calls('info').length >= 1, `${calls('info').length}`);

// An explicit "save this to disk" request has nowhere to fall back to, so it
// must fail honestly rather than pretending it saved something.
const dl = await fetch(`${APP}/api/youtube/stream/${VIDEO}?download=1`);
check('B1 an explicit download request fails loudly instead of silently proxying',
  dl.status >= 400, `status ${dl.status}`);

// The error MESSAGE is user-facing: it reaches toasts. A raw traceback tells
// the listener nothing and leaks absolute server paths.
const dlBody = await dl.json().catch(() => ({}));
const msg = String(dlBody.error ?? '');
check('B2 the error is a sentence, not a Python traceback',
  !msg.includes('Traceback') && !msg.includes('site-packages') && !msg.includes('/opt/'),
  msg.slice(0, 90));
check('B3 it still says what actually went wrong',
  /403|forbidden|download/i.test(msg), msg.slice(0, 90));

origin.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
