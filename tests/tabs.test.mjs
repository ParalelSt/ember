/** The tab store.
 *
 *      node tests/fake-songsterr.mjs &      # port 4330
 *      node tests/tabs.test.mjs             # or: npm run test:tabs
 *
 *  Covers upload, list, match-to-song, download and delete, plus the parts
 *  that would be dangerous to get wrong: file-type sniffing (a renamed mp3 is
 *  not a tab), the size cap, and sharing. A tab someone adds is shared with
 *  everyone on the server; only its uploader (or an admin) can delete it; a
 *  private row from before sharing stays private. The same holds through
 *  PocketBase's own rules, not just the web routes. Songsterr hints are
 *  searched once per song and kept on the row.
 *
 *  Needs the sandbox from tests/README.md (PB on 8091, app on 3010, with
 *  MUSIC_DIR pointed at the sandbox, SONGSTERR_BASE at the fake). */
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const SONGSTERR = process.env.FAKE_SONGSTERR_URL ?? 'http://127.0.0.1:4330';
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

async function user(label, extra = {}) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random()*1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true, ...extra }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, token: auth.token, cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

/** PocketBase directly, with a member's own token: the collection rules. */
const pbAs = (u, p, init = {}) => fetch(PB + p, { ...init, headers: { ...(init.headers || {}), Authorization: u.token } });
const pbAdmin = (p, init = {}) => fetch(PB + p, { ...init,
  headers: { ...(init.headers || {}), Authorization: tok, ...(init.body ? { 'content-type': 'application/json' } : {}) } });

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

// ── another member: shared by default ─────────────────────────────────────
const song = `?title=${encodeURIComponent('Master of Puppets')}&artist=Metallica`;
const bobList = await as(bob, '/api/tabs/files' + song).then((r) => r.json());
const bobSees = (bobList.tabs ?? []).find((t) => t.id === tabId);
check('E1 another member sees the shared tab for that song', !!bobSees, `${(bobList.tabs ?? []).length} tab(s)`);
check('E2 …marked shared, not theirs, not deletable by them',
  bobSees?.shared === true && bobSees?.mine === false && bobSees?.canDelete === false, JSON.stringify(bobSees ?? {}).slice(0, 120));
const bobDl = await as(bob, `/api/tabs/files/${tabId}/download`);
const bobBytes = Buffer.from(await bobDl.arrayBuffer().catch(() => new ArrayBuffer(0)));
check('E3 another member can download it', bobDl.status === 200 && bobBytes.length === gp5.length, `status ${bobDl.status}`);
const bobDel = await as(bob, `/api/tabs/files/${tabId}`, { method: 'DELETE' }).then((r) => r.status);
check('E4 another member cannot delete it', bobDel === 403, `status ${bobDel}`);
const stillThere = await as(alice, `/api/tabs/files/${tabId}/download`).then((r) => r.status);
check('E5 …and it is still there afterwards', stillThere === 200, `status ${stillThere}`);

// The same through PocketBase's own rules, with the members' own tokens.
const pbList = await pbAs(bob, `/api/collections/tabs/records?filter=${encodeURIComponent(`id = "${tabId}"`)}`).then((r) => r.json());
check('E6 PocketBase lists the shared row to another member', (pbList.items ?? []).length === 1, `${(pbList.items ?? []).length} row(s)`);
const pbDel = await pbAs(bob, `/api/collections/tabs/records/${tabId}`, { method: 'DELETE' }).then((r) => r.status);
check('E7 PocketBase refuses another member\'s delete', pbDel === 403 || pbDel === 404, `status ${pbDel}`);

// ── a private row from before sharing stays private ─────────────────────────
const legacy = await pbAdmin('/api/collections/tabs/records', { method: 'POST', body: JSON.stringify({
  user: alice.id, title: 'Legacy Riff', artist: 'Oldband', file: 'legacy-missing.gp5', size_bytes: 200,
}) }).then((r) => r.json());
check('P1 a legacy row (no store fields) can be seeded', typeof legacy.id === 'string', JSON.stringify(legacy).slice(0, 120));
const legacySong = `?title=${encodeURIComponent('Legacy Riff (Remastered)')}&artist=Oldband`;
const aliceLegacy = await as(alice, '/api/tabs/files' + legacySong).then((r) => r.json());
check('P2 its uploader still finds it by song', (aliceLegacy.tabs ?? []).some((t) => t.id === legacy.id && t.shared === false));
const bobLegacy = await as(bob, '/api/tabs/files' + legacySong).then((r) => r.json());
check('P3 another member does not see it', !(bobLegacy.tabs ?? []).some((t) => t.id === legacy.id));
const bobLegacyDl = await as(bob, `/api/tabs/files/${legacy.id}/download`).then((r) => r.status);
check('P4 …nor download it', bobLegacyDl === 404, `status ${bobLegacyDl}`);
const pbLegacy = await pbAs(bob, `/api/collections/tabs/records/${legacy.id}`).then((r) => r.status);
check('P5 PocketBase hides it from another member too', pbLegacy === 404, `status ${pbLegacy}`);
const legacyRow = await pbAdmin(`/api/collections/tabs/records/${legacy.id}`).then((r) => r.json());
check('P6 the store fields were filled in, shared left off',
  legacyRow.kind === 'file' && legacyRow.format === 'gp5' && legacyRow.song_key === 'legacy riff::::oldband' && legacyRow.shared === false,
  `${legacyRow.kind} ${legacyRow.format} ${legacyRow.song_key} shared=${legacyRow.shared}`);
await pbAdmin(`/api/collections/tabs/records/${legacy.id}`, { method: 'DELETE' });

// ── Songsterr hints: searched once, kept on the row ───────────────────────
const fake = await fetch(`${SONGSTERR}/__calls`).then((r) => r.json()).catch(() => null);
check('S0 the fake Songsterr is running', !!fake, SONGSTERR);
if (fake) {
  const hintSong = `Hintsong ${Date.now()}`;
  const up = await upload(alice, gp5, 'hint.gp5', { title: hintSong, artist: 'Hintband' });
  const hintTab = (await up.json().catch(() => ({}))).tab;
  await fetch(`${SONGSTERR}/__reset`, { method: 'POST' });
  const q = `/api/tabs?title=${encodeURIComponent(hintSong)}&artist=Hintband`;
  const first = await as(bob, q).then((r) => r.json());
  check('S1 the Songsterr link-out comes back', (first.matches ?? []).length === 1 && /songsterr\.com/.test(first.matches[0].url),
    JSON.stringify(first).slice(0, 120));
  const row = await pbAdmin(`/api/collections/tabs/records/${hintTab?.id}`).then((r) => r.json());
  const tuning = row.hints?.songs?.[0]?.tracks?.[0]?.tuning;
  check('S2 hints are stored on the song\'s row, tuning per instrument',
    row.hints?.source === 'songsterr' && Array.isArray(tuning) && tuning.length === 6, JSON.stringify(row.hints ?? null).slice(0, 120));
  await as(alice, `/api/tabs?title=${encodeURIComponent(hintSong + ' (Live)')}&artist=Hintband`).then((r) => r.json());
  const calls = await fetch(`${SONGSTERR}/__calls`).then((r) => r.json());
  check('S3 the search ran once for two lookups of the song', calls.count === 1, `${calls.count} call(s)`);
  const down = await as(alice, '/api/tabs?title=zzfail&artist=Nobody');
  check('S4 Songsterr failing is an empty list, not an error', down.status === 200 && (await down.json()).matches?.length === 0);
  if (hintTab?.id) await as(alice, `/api/tabs/files/${hintTab.id}`, { method: 'DELETE' });
}

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
const goneForBob = await as(bob, '/api/tabs/files' + song).then((r) => r.json());
check('G3 …for the other member too', !(goneForBob.tabs ?? []).some((t) => t.id === tabId));

// ── an admin can delete anyone's tab ────────────────────────────────────────
const carol = await user('carol-admin', { is_admin: true });
const other = await upload(bob, gp5, 'bob.gp5', { title: 'Admin Deletes This', artist: 'Bob' }).then((r) => r.json());
const adminDel = await as(carol, `/api/tabs/files/${other.tab?.id}`, { method: 'DELETE' }).then((r) => r.status);
check('G4 an admin member can delete someone else\'s tab', adminDel === 200, `status ${adminDel}`);

// ── signed out ────────────────────────────────────────────────────────────
const anon = await fetch(`${APP}/api/tabs/files`, { redirect: 'manual' }).then((r) => r.status);
check('H1 signed-out cannot list tabs', [401, 403, 307].includes(anon), `status ${anon}`);

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
process.exit(failed.length ? 1 : 0);
