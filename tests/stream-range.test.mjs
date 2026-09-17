/** Can the host still answer a Range request once yt-dlp goes stale?
 *
 *      node tests/stream-range.test.mjs   # or: npm run test:stream-range
 *
 *  Why this matters: a Range request is not an edge case. The desktop engine
 *  sends one whenever its stream drops a chunk (stream-download refills the
 *  gap), and every browser sends one to seek. If the answer is an error, the
 *  native engine's source dies, rodio reports end-of-source, and the player
 *  hears "track finished" and starts the NEXT song part-way through this one
 *  (see apps/desktop/src-tauri/src/audio/skip_repro.rs).
 *
 *  The state being reproduced is the one the owner's server is in: yt-dlp too
 *  old to download, so every uncached track is served by proxying googlevideo
 *  live, and the signed URL refuses byte-range refetches.
 *
 *  Its own server, with a fake player whose downloads fail:
 *
 *      STREAM_MODE= PYTHON_BIN=/bin/bash \
 *      PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      FAKE_FAIL_DOWNLOAD=1 FAKE_STREAM_URL=http://127.0.0.1:4410/audio \
 *      MUSIC_DIR=/tmp/ember-range-test/music \
 *      FAKE_PLAYER_LOG=/tmp/ember-range-test/calls.log \
 *      STREAM_CACHE_WARM=0 npx next start -p 3009
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.STREAM_APP_URL ?? 'http://127.0.0.1:3009';
const MUSIC = process.env.MUSIC_DIR ?? '/tmp/ember-range-test/music';
const ORIGIN_PORT = Number(process.env.FAKE_ORIGIN_PORT ?? 4410);
const PROXIED = 'ccccccccccc'; // no cached copy: served by proxying the origin
const CACHED = 'ddddddddddd'; // already on disk: served from the file
const AUDIO = Buffer.from('LIVE-STREAMED-AUDIO-BYTES-0123456789');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
};

// Stand-in for googlevideo. A plain GET works (that is why proxy mode is the
// fallback at all); a Range request is refused, which is what a signed URL
// does once the client that resolved it no longer matches.
let rangeRequests = 0;
const origin = http.createServer((req, res) => {
  if (req.headers.range) {
    rangeRequests += 1;
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  res.writeHead(200, {
    'content-type': 'audio/mp4',
    'content-length': String(AUDIO.length),
    'accept-ranges': 'bytes',
  });
  res.end(AUDIO);
});
await new Promise((r) => origin.listen(ORIGIN_PORT, '127.0.0.1', r));

// 1. Playback starts: the download fails, the route proxies the live stream.
const first = await fetch(`${APP}/api/youtube/stream/${PROXIED}`);
const firstBody = Buffer.from(await first.arrayBuffer());
check('A1 a fresh play still works through the live proxy', first.status === 200, `status ${first.status}`);
check('A2 the bytes came from the origin', firstBody.equals(AUDIO), firstBody.toString().slice(0, 40));

// 2. The same track, now asked for from the middle: a refill after a dropped
//    chunk, or a seek in any browser.
const ranged = await fetch(`${APP}/api/youtube/stream/${PROXIED}`, {
  headers: { Range: `bytes=${Math.floor(AUDIO.length / 2)}-` },
});
const rangedBody = await ranged.text();
check(
  'B1 (bug) a mid-file Range request is refused, so a resume or a seek kills the stream',
  ranged.status >= 400,
  `status ${ranged.status} ${rangedBody.slice(0, 80)}`,
);
check('B2 the origin was asked with the Range header before it failed', rangeRequests >= 1, `${rangeRequests} range requests`);
check(
  'B3 the failure reads as a server error, not as audio (the engine cannot tell either)',
  !rangedBody.startsWith('LIVE-STREAMED'),
  rangedBody.slice(0, 60),
);

// 3. Control: a track already on disk answers Range requests properly, which
//    is why this only bites tracks the stale yt-dlp could not cache.
fs.mkdirSync(MUSIC, { recursive: true });
fs.writeFileSync(path.join(MUSIC, `${CACHED}.m4a`), AUDIO);
const cachedRange = await fetch(`${APP}/api/youtube/stream/${CACHED}`, {
  headers: { Range: 'bytes=10-19' },
});
const cachedBody = Buffer.from(await cachedRange.arrayBuffer());
check('C1 a cached track answers a Range request with 206', cachedRange.status === 206, `status ${cachedRange.status}`);
check('C2 and with the right bytes', cachedBody.equals(AUDIO.subarray(10, 20)), cachedBody.toString());

origin.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
