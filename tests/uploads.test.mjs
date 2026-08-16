/** End-to-end test for custom song uploads.
 *
 *  Covers the upload → discoverable → playable → deletable loop, plus the
 *  things that would be dangerous to get wrong: file-type validation, path
 *  traversal, ownership, and the size/rate caps.
 *
 *      node tests/uploads.test.mjs      # or: npm run test:uploads
 *
 *  Needs the sandbox from tests/README.md, with the app server started as:
 *      MAX_UPLOAD_MB=1 MUSIC_DIR=<sandbox>/music npx next start -p 3005
 *  (1MB makes the too-large case fast; MUSIC_DIR keeps files out of my_music.)
 *
 *  Env overrides: PB_URL, APP_URL, MUSIC_DIR, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD. */
import fs from 'node:fs';
import path from 'node:path';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const UPLOAD_DIR = path.join(process.env.MUSIC_DIR ?? '', 'uploads');
const PASSWORD = 'BugTest2026!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();

async function makeUser(label, { isAdmin = false } = {}) {
  const email = `${label}-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({
      email, password: PASSWORD, passwordConfirm: PASSWORD,
      name: label, verified: true, is_admin: isAdmin,
    }),
  });
  if (!res.ok) throw new Error(`create ${label} failed: ${res.status} ${await res.text()}`);
  const rec = await res.json();
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PASSWORD }),
  }).then((r) => r.json());
  return {
    id: rec.id,
    cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`,
  };
}

/** A real, playable WAV: 44-byte RIFF header + a quiet sine. */
function makeWav(seconds = 1, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function upload(cookie, { bytes, filename, type, title, artist, durationSec = 1 }) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), filename);
  if (title !== undefined) fd.append('title', title);
  if (artist !== undefined) fd.append('artist', artist);
  fd.append('durationSec', String(durationSec));
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', headers: { cookie }, body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── auth ──────────────────────────────────────────────────────────────────
// redirect:'manual' — otherwise fetch follows the middleware's 307 and
// re-POSTs to the sign-in page, which muddies what we're asserting.
const anon = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: new FormData(), redirect: 'manual' });
check('A1 upload rejects signed-out callers', anon.status === 401 || anon.status === 307, `status ${anon.status}`);
const anonList = await fetch(`${APP_URL}/api/uploads`, { redirect: 'manual' });
check('A2 upload list rejects signed-out callers',
  anonList.status === 401 || anonList.status === 307, `status ${anonList.status}`);

const alice = await makeUser('alice');
const bob = await makeUser('bob');

// ── happy path ────────────────────────────────────────────────────────────
const wav = makeWav(1);
const title = `Test Song ${Date.now()}`;
const ok = await upload(alice.cookie, { bytes: wav, filename: 'my song.wav', type: 'audio/wav', title, artist: 'Test Artist' });
check('B1 upload accepted', ok.status === 201, `status ${ok.status} ${JSON.stringify(ok.json)?.slice(0, 120)}`);
const track = ok.json?.track;
check('B2 returns a playable Track', !!track?.id?.startsWith('upload:') && track?.source === 'upload');
check('B3 stream URL points at the uploads route', track?.streamUrl === `/api/uploads/${track?.sourceId}/stream`);
check('B4 metadata preserved', track?.title === title && track?.artist === 'Test Artist');

const stored = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : [];
check('B5 file written to the uploads dir', stored.length > 0, `${stored.length} file(s) in ${UPLOAD_DIR}`);
check('B6 stored name is random, not the user’s filename',
  !stored.some((f) => f.includes('my song')), stored.slice(-1)[0]);

// ── discoverable by everyone ──────────────────────────────────────────────
const list = await fetch(`${APP_URL}/api/uploads`, { headers: { cookie: bob.cookie } }).then((r) => r.json());
check('C1 another member sees it in the uploads list',
  (list.tracks ?? []).some((t) => t.id === track?.id));

const searchWord = title.split(' ')[0];
const found = await fetch(`${APP_URL}/api/search?q=${encodeURIComponent(title)}`, { headers: { cookie: bob.cookie } })
  .then((r) => r.json());
check('C2 another member finds it in search', (found.tracks ?? []).some((t) => t.id === track?.id), `q="${title}"`);
check('C3 uploads rank above YouTube results', found.tracks?.[0]?.id === track?.id, found.tracks?.[0]?.title);
const anonSearch = await fetch(`${APP_URL}/api/search?q=${encodeURIComponent(searchWord)}`).then((r) => r.json());
check('C4 signed-out search leaks no uploads',
  !(anonSearch.tracks ?? []).some((t) => t.source === 'upload'));

// ── streaming ─────────────────────────────────────────────────────────────
const streamUrl = `${APP_URL}${track?.streamUrl}`;
const full = await fetch(streamUrl, { headers: { cookie: bob.cookie } });
const body = Buffer.from(await full.arrayBuffer());
check('D1 streams to another member', full.status === 200, `status ${full.status}`);
check('D2 correct content type', full.headers.get('content-type') === 'audio/wav');
check('D3 whole file returned intact', body.length === wav.length && body.equals(wav), `${body.length}/${wav.length} bytes`);
check('D4 advertises range support', full.headers.get('accept-ranges') === 'bytes');

const ranged = await fetch(streamUrl, { headers: { cookie: bob.cookie, range: 'bytes=100-199' } });
const chunk = Buffer.from(await ranged.arrayBuffer());
check('D5 range request returns 206', ranged.status === 206, `status ${ranged.status}`);
check('D6 range bytes are correct',
  chunk.length === 100 && chunk.equals(wav.subarray(100, 200)));
check('D7 content-range header correct',
  ranged.headers.get('content-range') === `bytes 100-199/${wav.length}`, ranged.headers.get('content-range'));
const bad = await fetch(streamUrl, { headers: { cookie: bob.cookie, range: `bytes=${wav.length + 10}-` } });
check('D8 unsatisfiable range → 416', bad.status === 416, `status ${bad.status}`);
const anonStream = await fetch(streamUrl, { redirect: 'manual' });
check('D9 streaming requires a session', anonStream.status === 401 || anonStream.status === 307, `status ${anonStream.status}`);

// ── validation ────────────────────────────────────────────────────────────
const notAudio = await upload(alice.cookie, {
  bytes: Buffer.from('This is definitely not a song, it is a text file.'),
  filename: 'song.mp3', type: 'audio/mpeg', title: 'Fake',
});
check('E1 non-audio bytes rejected even with an audio mime', notAudio.status === 415, `status ${notAudio.status}`);

const tooBig = await upload(alice.cookie, {
  bytes: Buffer.concat([makeWav(1), Buffer.alloc(1024 * 1024 + 1024)]),
  filename: 'big.wav', type: 'audio/wav', title: 'Big',
});
check('E2 oversize file rejected', tooBig.status === 413, `status ${tooBig.status}`);

const empty = await upload(alice.cookie, { bytes: Buffer.alloc(0), filename: 'empty.wav', type: 'audio/wav', title: 'Empty' });
check('E3 empty file rejected', empty.status === 400, `status ${empty.status}`);

const noTitle = await upload(alice.cookie, { bytes: makeWav(1), filename: 'Artist - Fallback Title.wav', type: 'audio/wav' });
check('E4 missing title falls back to the filename',
  noTitle.status === 201 && noTitle.json?.track?.title === 'Artist - Fallback Title', noTitle.json?.track?.title);

// ── path traversal ────────────────────────────────────────────────────────
// Forge a record whose filename escapes the uploads dir; the stream route
// must refuse rather than read it.
const evil = await fetch(`${PB_URL}/api/collections/uploads/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({
    uploader: alice.id, title: 'Evil', filename: '../../../../etc/passwd', mime: 'audio/wav',
  }),
}).then((r) => r.json());
const traversal = await fetch(`${APP_URL}/api/uploads/${evil.id}/stream`, { headers: { cookie: alice.cookie } });
check('F1 path traversal refused', traversal.status === 404, `status ${traversal.status}`);

// ── ownership + delete ────────────────────────────────────────────────────
const notMine = await fetch(`${APP_URL}/api/uploads/${track.sourceId}`, {
  method: 'DELETE', headers: { cookie: bob.cookie },
});
check('G1 another member cannot delete it', notMine.status === 403, `status ${notMine.status}`);

const before = fs.readdirSync(UPLOAD_DIR).length;
const mine = await fetch(`${APP_URL}/api/uploads/${track.sourceId}`, {
  method: 'DELETE', headers: { cookie: alice.cookie },
});
check('G2 uploader can delete it', mine.status === 200, `status ${mine.status}`);
check('G3 file removed from disk', fs.readdirSync(UPLOAD_DIR).length === before - 1);
const gone = await fetch(streamUrl, { headers: { cookie: alice.cookie } });
check('G4 stream 404s after delete', gone.status === 404, `status ${gone.status}`);

// ── cleanup must never reap uploads ───────────────────────────────────────
// The 14-day cleanup deletes tracks nobody played. An upload row is
// deliberate content, so it must be counted as protected, never deleted.
const admin = await makeUser('cleanupadmin', { isAdmin: true });
const uploadRow = await fetch(`${PB_URL}/api/collections/tracks/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({
    external_id: `upload:stale-${Date.now()}`, source: 'upload', source_id: 'stale',
    title: 'Stale upload', artist: 'Nobody', duration_sec: 1,
  }),
}).then((r) => r.json());
const dry = await fetch(`${APP_URL}/api/admin/cleanup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: admin.cookie },
  body: JSON.stringify({ apply: true }),
}).then((r) => r.json());
const stillThere = await fetch(`${PB_URL}/api/collections/tracks/records/${uploadRow.id}`, {
  headers: { Authorization: token },
});
check('H1 cleanup ran', typeof dry?.scanned === 'number', JSON.stringify(dry).slice(0, 120));
check('H2 an unplayed upload survives cleanup', stillThere.status === 200, `status ${stillThere.status}`);

// ── rate limit ────────────────────────────────────────────────────────────
// Alice has used 5 of 10 this hour (2 successes + 3 rejects that still count).
const carol = await makeUser('carol');
let limitStatus = 0;
for (let i = 0; i < 12; i++) {
  const r = await upload(carol.cookie, { bytes: makeWav(1), filename: `s${i}.wav`, type: 'audio/wav', title: `Spam ${i}` });
  if (r.status === 429) { limitStatus = 429; break; }
}
check('I1 upload spam is rate-limited', limitStatus === 429, limitStatus ? 'blocked' : 'never blocked in 12 tries');

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
