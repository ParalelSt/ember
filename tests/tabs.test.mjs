/** Guitar Pro tab storage — Phase 1 of in-app tabs.
 *
 *      node tests/tabs.test.mjs      # or: npm run test:tabs
 *
 *  Covers upload → list → match-to-song → download → delete, plus the parts
 *  that would be dangerous to get wrong: file-type sniffing (a renamed mp3 is
 *  not a tab), the size cap, and cross-user access — a tab is private to its
 *  uploader, unlike the shared music library.
 *
 *  Needs the sandbox from tests/README.md (PB on 8091, app on 3010, with
 *  MUSIC_DIR pointed at the sandbox). */
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PW = 'BugTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}
const tok = await adminToken();

async function user(label) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random()*1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

const as = (u, path, init = {}) => fetch(APP + path, {
  ...init, redirect: 'manual',
  headers: { ...(init.headers || {}), cookie: u.cookie, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}) },
});

// --- fixtures: real Guitar Pro headers ------------------------------------
const pad = (buf, n) => Buffer.concat([buf, Buffer.alloc(Math.max(0, n - buf.length))]);
/** gp3/4/5 open with a Pascal string: length byte, then the version banner. */
const gpFile = (banner) => pad(Buffer.concat([Buffer.from([banner.length]), Buffer.from(banner, 'ascii')]), 200);
const gp5 = gpFile('FICHIER GUITAR PRO v5.10');
const gp4 = gpFile('FICHIER GUITAR PRO v4.06');
const gpx = pad(Buffer.from('BCFZ', 'ascii'), 200);
/** gp7 is a zip whose entry names mention score.gpif in plaintext. */
const gp7 = pad(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('Content/score.gpif', 'ascii')]), 200);
const mp3 = pad(Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(20)]), 200);
const plainZip = pad(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('holiday-photos.jpg', 'ascii')]), 200);

async function upload(u, bytes, name, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return as(u, '/api/tabs/files', { method: 'POST', body: form });
}

const alice = await user('alice');
const bob = await user('bob');

// ── accepted formats ──────────────────────────────────────────────────────
const r5 = await upload(alice, gp5, 'song.gp5', { title: 'Master of Puppets', artist: 'Metallica', instrument: 'Guitar 1' });
const body5 = await r5.json().catch(() => ({}));
check('A1 a .gp5 uploads', r5.status === 201, `status ${r5.status}`);
check('A2 …and comes back with its metadata', body5.tab?.title === 'Master of Puppets' && body5.tab?.instrument === 'Guitar 1');
const tabId = body5.tab?.id;

for (const [label, bytes, name] of [['gp4', gp4, 'old.gp4'], ['gpx', gpx, 'six.gpx'], ['gp7 zip', gp7, 'seven.gp']]) {
  const r = await upload(alice, bytes, name, { title: `T ${label}`, artist: 'Someone' });
  check(`A3 a ${label} file uploads`, r.status === 201, `status ${r.status}`);
}

// ── rejected ──────────────────────────────────────────────────────────────
const renamed = await upload(alice, mp3, 'sneaky.gp5', { title: 'Not a tab' });
check('B1 an mp3 renamed .gp5 is refused', renamed.status === 415, `status ${renamed.status}`);
const zipOnly = await upload(alice, plainZip, 'photos.gp', { title: 'Not a tab either' });
check('B2 a zip that is not a Guitar Pro file is refused', zipOnly.status === 415, `status ${zipOnly.status}`);
const empty = await upload(alice, Buffer.alloc(0), 'empty.gp5');
check('B3 an empty file is refused', empty.status === 400, `status ${empty.status}`);
const huge = await upload(alice, Buffer.concat([gp5, Buffer.alloc(6 * 1024 * 1024)]), 'huge.gp5');
check('B4 an oversized file is refused', huge.status === 413, `status ${huge.status}`);

// ── listing and matching ──────────────────────────────────────────────────
const mine = await as(alice, '/api/tabs/files').then((r) => r.json());
check('C1 the uploader sees their tabs', (mine.tabs ?? []).length >= 4, `${(mine.tabs ?? []).length} tab(s)`);

const matched = await as(alice, '/api/tabs/files?title=' + encodeURIComponent('Master of Puppets (Remastered 2017)') + '&artist=Metallica')
  .then((r) => r.json());
check('C2 a noisy YouTube title still matches the tab',
  (matched.tabs ?? []).some((t) => t.id === tabId), `${(matched.tabs ?? []).length} match(es)`);

const unmatched = await as(alice, '/api/tabs/files?title=Wonderwall&artist=Oasis').then((r) => r.json());
check('C3 an unrelated song matches nothing', (unmatched.tabs ?? []).length === 0, `${(unmatched.tabs ?? []).length} match(es)`);

// ── download ──────────────────────────────────────────────────────────────
const dl = await as(alice, `/api/tabs/files/${tabId}/download`);
const dlBytes = Buffer.from(await dl.arrayBuffer().catch(() => new ArrayBuffer(0)));
check('D1 the uploader can download the file', dl.status === 200, `status ${dl.status}`);
check('D2 the bytes come back unchanged', dlBytes.length === gp5.length && dlBytes.subarray(0, 25).equals(gp5.subarray(0, 25)),
  `${dlBytes.length} bytes`);

// ── another member ────────────────────────────────────────────────────────
const bobList = await as(bob, '/api/tabs/files').then((r) => r.json());
check('E1 another member sees none of them', (bobList.tabs ?? []).length === 0, `${(bobList.tabs ?? []).length} tab(s)`);
const bobDl = await as(bob, `/api/tabs/files/${tabId}/download`).then((r) => r.status);
check('E2 another member cannot download it', bobDl === 403 || bobDl === 404, `status ${bobDl}`);
const bobDel = await as(bob, `/api/tabs/files/${tabId}`, { method: 'DELETE' }).then((r) => r.status);
check('E3 another member cannot delete it', bobDel === 403 || bobDel === 404, `status ${bobDel}`);
const stillThere = await as(alice, `/api/tabs/files/${tabId}/download`).then((r) => r.status);
check('E4 …and it is still there afterwards', stillThere === 200, `status ${stillThere}`);

// ── traversal ─────────────────────────────────────────────────────────────
for (const evil of ['..%2f..%2fetc%2fpasswd', '..', 'nope']) {
  const s = await as(alice, `/api/tabs/files/${evil}/download`).then((r) => r.status);
  check(`F cannot fetch "${evil}"`, s === 404 || s === 400 || s === 403, `status ${s}`);
}

// ── delete ────────────────────────────────────────────────────────────────
const del = await as(alice, `/api/tabs/files/${tabId}`, { method: 'DELETE' }).then((r) => r.status);
check('G1 the uploader can delete their tab', del === 200, `status ${del}`);
const gone = await as(alice, `/api/tabs/files/${tabId}/download`).then((r) => r.status);
check('G2 …and it is gone', gone === 404, `status ${gone}`);

// ── signed out ────────────────────────────────────────────────────────────
const anon = await fetch(`${APP}/api/tabs/files`, { redirect: 'manual' }).then((r) => r.status);
check('H1 signed-out cannot list tabs', [401, 403, 307].includes(anon), `status ${anon}`);

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
process.exit(failed.length ? 1 : 0);
