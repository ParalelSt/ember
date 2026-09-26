/** Who can make the host fetch a song (security audit 2026-09-25, M2).
 *
 *      node tests/stream-access.test.mjs
 *
 *  On main, /api/youtube/stream/<id> was public: anyone on the internet could
 *  make the host run yt-dlp for any video, with the owner's YouTube cookies.
 *  Now a song already on disk plays for anyone (shared /track links),
 *  anything else takes a signed-in member, and a video player.py refuses
 *  (a live stream always, or one over an opted-in length/size cap) comes
 *  back as 413 without a live-stream fallback. There is no cap by default.
 *
 *  Sandbox: PocketBase plus an app started with the fake player, e.g.
 *
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      FAKE_DOWNLOAD_SECONDS=0 FAKE_TOO_LONG_FILE=$SB/too-long.txt \
 *      MUSIC_DIR=$SB/music FAKE_PLAYER_LOG=$SB/calls.log \
 *      POCKETBASE_URL=http://127.0.0.1:8148 npx next start -p 3110
 *
 *  Env: APP_URL, PB_URL, PB_ADMIN_PASSWORD, MUSIC_DIR, FAKE_PLAYER_LOG,
 *  FAKE_TOO_LONG_FILE (the same paths the app was started with). */
import fs from 'node:fs';
import path from 'node:path';
import { memberCookie } from './sandbox-member.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3110';
const MUSIC = process.env.MUSIC_DIR;
const LOG = process.env.FAKE_PLAYER_LOG;
const TOO_LONG = process.env.FAKE_TOO_LONG_FILE;
if (!MUSIC || !LOG || !TOO_LONG) throw new Error('set MUSIC_DIR, FAKE_PLAYER_LOG and FAKE_TOO_LONG_FILE as the app has them');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const run = `${process.pid.toString(36)}${Date.now().toString(36)}`.slice(-7);
const vid = (tag) => `${tag}${run}`.padEnd(11, 'x').slice(0, 11);
const calls = (cmd, id) => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '').split('\n').filter((l) => l === `${cmd} ${id}`).length;
const stream = (id, { query = '', cookie } = {}) =>
  fetch(`${APP}/api/youtube/stream/${id}${query}`, { headers: cookie ? { cookie } : {} });

fs.mkdirSync(MUSIC, { recursive: true });

// Signed out.
const cached = vid('ac');
fs.writeFileSync(path.join(MUSIC, `${cached}.m4a`), 'ON-DISK-AUDIO');
const onDisk = await stream(cached);
check('A1 a song on disk plays signed out (shared /track links)', onDisk.status === 200 && (await onDisk.text()) === 'ON-DISK-AUDIO', String(onDisk.status));

for (const [name, query] of [['a play', ''], ['a prefetch', '?prefetch=1'], ['a save-to-disk', '?download=1']]) {
  const id = vid(`an${query.length}`);
  const res = await stream(id, { query });
  const body = await res.json().catch(() => null);
  check(`A2 signed out, ${name} of a song not on disk is 401`, res.status === 401 && body?.cause === 'sign-in', `${res.status} ${JSON.stringify(body)}`);
  check(`A3 and yt-dlp never ran for it (${name})`, calls('download', id) === 0 && calls('info', id) === 0);
}
const dlAnon = await fetch(`${APP}/api/youtube/download/${vid('ad')}`, { method: 'POST' });
check('A4 the download route is 401 signed out', dlAnon.status === 401, String(dlAnon.status));
const forged = await stream(vid('af'), { cookie: 'pb_auth=%7B%22token%22%3A%22x.y.z%22%2C%22record%22%3A%7B%22id%22%3A%22abc%22%7D%7D' });
check('A5 a made-up pb_auth cookie is signed out too', forged.status === 401, String(forged.status));

// A member.
const cookie = await memberCookie({ label: 'stream-access' });
const fresh = vid('mf');
const played = await stream(fresh, { cookie });
check('B1 a member plays a song not on disk', played.status === 200 && (await played.text()) === `FAKE-AUDIO-${fresh}`, String(played.status));
check('B2 it was downloaded once', calls('download', fresh) === 1, String(calls('download', fresh)));

const long = vid('ml');
fs.appendFileSync(TOO_LONG, `${long}\n`);
const tooLong = await stream(long, { cookie });
const tooLongBody = await tooLong.json().catch(() => null);
check('B3 a refused video (live, or over an opted-in cap) is 413', tooLong.status === 413 && tooLongBody?.cause === 'too-long', `${tooLong.status} ${JSON.stringify(tooLongBody)}`);
check('B4 and is not streamed live instead', calls('info', long) === 0, `info calls ${calls('info', long)}`);
const dlLong = await fetch(`${APP}/api/youtube/download/${long}`, { method: 'POST', headers: { cookie } });
check('B5 the download route says 413 for it too', dlLong.status === 413, String(dlLong.status));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
