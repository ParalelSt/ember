/** Playlist import, stages 1 to 4 (docs/imports.md) at the API: the Spotify
 *  embed-page source, YouTube Music playlists, and background jobs with the
 *  scored match split, picks and Remove song. The browser side (the dialog,
 *  the sidebar ring, a restart mid-job, a 503, the review sheet) is
 *  tests/import-ui.test.mjs.
 *
 *      node tests/import.test.mjs            # or: npm run test:import
 *
 *  Needs its own app server pointed at the fakes, and nothing on the internet:
 *
 *    SB=/tmp/ember-import-test && mkdir -p "$SB/music"
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8094 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      SPOTIFY_EMBED_BASE=http://127.0.0.1:4331 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      FAKE_PLAYER_LOG="$SB/calls.log" MUSIC_DIR="$SB/music" \
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
 *      npx next start -p 3034 &
 *
 *  Then: PB_URL=http://127.0.0.1:8094 APP_URL=http://127.0.0.1:3034 node tests/import.test.mjs
 *
 *  The test starts tests/fake-spotify.mjs on :4331 itself (or reuses one
 *  already running there). fake-player.sh answers `match` from
 *  tests/fixtures/imports/ytm-candidates.json and `ytplaylist` from
 *  tests/fixtures/imports/ytm-playlists.json. */
import { startFakeSpotify, TOP_HITS_ID, EIGHTIES_ID, BROKEN_ID } from './fake-spotify.mjs';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8094';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3034';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PW = 'ImportTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

let fake = null;
try {
  fake = await startFakeSpotify();
} catch (e) {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log('fake Spotify already running on :4331, reusing it');
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
const created = [];

async function user(label) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }),
  }).then((r) => r.json());
  created.push(rec.id);
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PW }),
  }).then((r) => r.json());
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;
}

// Inspect allows 5 starts per 10 minutes per user, so spread the calls.
const spotifyUser = await user('import-spotify');
const errorUser = await user('import-errors');
const ytUser = await user('import-yt');

const post = (cookie, path, body) =>
  fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

try {
  // ── A. Spotify inspect, from the saved embed page ──
  const a1 = await post(spotifyUser, '/api/import/inspect', { url: `https://open.spotify.com/playlist/${TOP_HITS_ID}?si=abc` });
  check('A1 Spotify link inspects', a1.status === 200 && a1.body?.source === 'spotify', `status ${a1.status} ${JSON.stringify(a1.body)?.slice(0, 200)}`);
  check('A2 name and cover come from oEmbed', a1.body?.name === 'Today’s Top Hits' && /^https:\/\/i\.scdn\.co\//.test(a1.body?.coverUrl ?? ''), `${a1.body?.name} ${a1.body?.coverUrl}`);
  const items = a1.body?.items ?? [];
  check('A3 all 50 tracks, in source order', items.length === 50 && items.every((it, i) => it.position === i), `count ${items.length}`);
  check(
    'A4 source item fields',
    items[0]?.title === 'Bass Persuades' && items[0]?.artist === 'Miley Cyrus' && items[0]?.durationMs === 202460 &&
      items[0]?.explicit === false && items[0]?.uri === 'spotify:track:2FZcjBYK4dTt48q94pJbJD',
    JSON.stringify(items[0]),
  );
  check('A5 multi-artist line split', JSON.stringify(items[3]?.artists) === JSON.stringify(['KAROL G', 'Judeline', 'rusowsky']), JSON.stringify(items[3]));
  check('A6 under 100 tracks is not flagged as cut off', a1.body?.truncated === false);

  const a7 = await post(spotifyUser, '/api/import/inspect', { url: `spotify:playlist:${EIGHTIES_ID}` });
  check('A7 a 100-track playlist is flagged as possibly longer', a7.status === 200 && a7.body?.items?.length === 100 && a7.body?.truncated === true,
    `status ${a7.status} count ${a7.body?.items?.length} truncated ${a7.body?.truncated}`);

  // ── B. Spotify errors people can act on ──
  const b1 = await post(errorUser, '/api/import/inspect', { url: 'https://open.spotify.com/playlist/1234567890abcdefghijkl' });
  check('B1 unknown or private playlist is a 404 that says so', b1.status === 404 && /couldn't find that playlist/i.test(b1.body?.error ?? '') && /public/i.test(b1.body?.error ?? ''),
    `status ${b1.status} ${b1.body?.error}`);
  const b2 = await post(errorUser, '/api/import/inspect', { url: `https://open.spotify.com/playlist/${BROKEN_ID}` });
  check('B2 a changed Spotify page is a 502 that says so', b2.status === 502 && /changed/i.test(b2.body?.error ?? ''), `status ${b2.status} ${b2.body?.error}`);
  const b3 = await post(errorUser, '/api/import/inspect', { url: 'https://open.spotify.com/album/1234567890abcdefghijkl' });
  check('B3 a non-playlist link is a 400', b3.status === 400 && /playlist link/i.test(b3.body?.error ?? ''), `status ${b3.status} ${b3.body?.error}`);
  if (fake) {
    const seen = fake.requests;
    check('B4 embed page and oEmbed both asked', seen.some((p) => p === `/embed/playlist/${TOP_HITS_ID}`) && seen.some((p) => p.startsWith('/oembed?url=')),
      JSON.stringify(seen.slice(0, 4)));
  }

  // ── C. A background job: every item comes back scored, split three ways ──
  const get = (cookie, path) =>
    fetch(APP + path, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const waitDone = async (cookie, id, ms = 90_000) => {
    const t0 = Date.now();
    for (;;) {
      const r = await get(cookie, `/api/import/jobs/${id}`);
      if (['done', 'failed', 'cancelled'].includes(r.body?.job?.status) || Date.now() - t0 > ms) return r.body;
      await new Promise((res) => setTimeout(res, 500));
    }
  };
  const c0 = await post(spotifyUser, '/api/import/jobs', { url: `https://open.spotify.com/playlist/${TOP_HITS_ID}` });
  check('C0 starting an import creates the playlist and a queued job', c0.status === 201 && !!c0.body?.playlistId &&
    c0.body?.job?.status === 'queued' && c0.body?.job?.total === 50, `status ${c0.status} ${JSON.stringify(c0.body)?.slice(0, 200)}`);
  const done = await waitDone(spotifyUser, c0.body?.job?.id);
  const results = done?.items ?? [];
  const by = (status) => results.filter((r) => r.status === status).map((r) => r.position);
  check('C1 the job finishes with one item per source track, in order', done?.job?.status === 'done' && results.length === 50 &&
    results.every((r, i) => r.position === i), `status ${done?.job?.status} count ${results.length}`);
  check('C2 accepted: 0, 1, 3, 5', JSON.stringify(by('accepted')) === '[0,1,3,5]', JSON.stringify(by('accepted')));
  check('C3 needs review: 2 (live version), 4 (fan upload)', JSON.stringify(by('review')) === '[2,4]', JSON.stringify(by('review')));
  check('C4 not found: the other 44', by('missing').length === 44, `${by('missing').length}`);
  check('C4b the job counts agree', done?.job?.accepted === 4 && done?.job?.review === 2 && done?.job?.missing === 44 && done?.job?.cursor === 50,
    JSON.stringify(done?.job));

  const r0 = results[0];
  check('C5 an accepted item keeps its source row and every candidate', r0?.source?.title === 'Bass Persuades' && r0?.candidates?.length === 2 &&
    r0?.videoId === 'D70Ld2UoZVI', JSON.stringify(r0?.candidates?.map((c) => c.track.title)));
  check('C6 best candidate first, with its score and reasons', r0?.candidates?.[0]?.track?.id === 'youtube:D70Ld2UoZVI' && r0?.confidence === 100 &&
    r0?.candidates?.[0]?.reasons?.includes('Length matches'), JSON.stringify(r0?.candidates?.[0]));
  check('C7 the remix is kept but scored down', r0?.candidates?.[1]?.score === 55 && r0?.candidates?.[1]?.reasons?.includes('Remix'),
    JSON.stringify(r0?.candidates?.[1]));
  check('C8 official audio beats the music video', results[1]?.candidates?.[0]?.track?.sourceId === 'hateThat002', results[1]?.candidates?.[0]?.track?.sourceId);
  check('C9 review item says why', results[2]?.confidence === 55 && results[2]?.candidates?.[0]?.reasons?.includes('Live version'),
    JSON.stringify(results[2]?.candidates?.[0]));
  check('C10 fan upload by someone else says so', results[4]?.candidates?.[0]?.reasons?.includes('Different artist') &&
    results[4]?.candidates?.[0]?.reasons?.includes('Fan upload'), JSON.stringify(results[4]?.candidates?.[0]?.reasons));
  check('C11 nothing on the first search: the title-only retry finds it', results[3]?.status === 'accepted' &&
    results[3]?.candidates?.[0]?.track?.sourceId === 'bbyWow00001', JSON.stringify(results[3]?.candidates?.[0]));
  check('C12 not-found items still keep their candidates', results[10]?.status === 'missing' && results[10]?.candidates?.length >= 1 &&
    results[10]?.confidence < 50, JSON.stringify({ c: results[10]?.confidence, n: results[10]?.candidates?.length }));

  const pl = await get(spotifyUser, `/api/playlists/${c0.body?.playlistId}`);
  check('C13 only the accepted tracks are in the playlist, in source order',
    JSON.stringify(pl.body?.tracks?.map((t) => t.sourceId)) === JSON.stringify(['D70Ld2UoZVI', 'hateThat002', 'bbyWow00001', 'aintInLA001']) &&
      pl.body?.playlist?.import_job === c0.body?.job?.id, JSON.stringify(pl.body?.tracks?.map((t) => t.sourceId)));
  const list = await get(spotifyUser, '/api/import/jobs');
  check('C14 the sidebar list has the job', list.body?.jobs?.some((j) => j.id === c0.body?.job?.id && j.playlistId === c0.body?.playlistId),
    JSON.stringify(list.body)?.slice(0, 200));
  const c15 = await fetch(`${APP}/api/import/jobs`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `https://open.spotify.com/playlist/${TOP_HITS_ID}` }),
  });
  // The proxy sends signed-out API calls to the sign-in page.
  check('C15 signed out never starts an import', c15.status === 401 || (c15.status === 307 && /\/auth\?/.test(c15.headers.get('location') ?? '')),
    `status ${c15.status}`);
  const c16 = await get(errorUser, `/api/import/jobs/${c0.body?.job?.id}`);
  check('C16 someone else cannot read the import', c16.status === 404, `status ${c16.status}`);
  const c17 = await post(errorUser, `/api/import/items/${results[2]?.id}`, { action: 'skip' });
  check('C17 someone else cannot settle its songs', c17.status === 404, `status ${c17.status}`);

  // Settling a song by hand: key picks and re-matches go through here.
  const loserStudio = results[2]?.candidates?.find((c) => c.track.sourceId === 'loserStudio')?.track;
  const c18 = await post(spotifyUser, `/api/import/items/${results[2]?.id}`, { action: 'pick', track: loserStudio });
  const pl2 = await get(spotifyUser, `/api/playlists/${c0.body?.playlistId}`);
  check('C18 a picked song lands at its source position', c18.status === 200 && c18.body?.item?.status === 'resolved' &&
    JSON.stringify(pl2.body?.tracks?.map((t) => t.sourceId)) === JSON.stringify(['D70Ld2UoZVI', 'hateThat002', 'loserStudio', 'bbyWow00001', 'aintInLA001']) &&
    c18.body?.job?.review === 1 && c18.body?.job?.accepted === 5, `status ${c18.status} ${JSON.stringify(pl2.body?.tracks?.map((t) => t.sourceId))}`);
  const c19 = await post(spotifyUser, `/api/import/items/${results[2]?.id}`, { action: 'pick', track: { ...loserStudio, source: 'upload' } });
  check('C19 only a YouTube song can be picked', c19.status === 400, `status ${c19.status}`);
  const c20 = await post(spotifyUser, `/api/import/items/${results[4]?.id}`, { action: 'skip' });
  check('C20 Remove song leaves it out and updates the counts', c20.status === 200 && c20.body?.item?.status === 'skipped' && c20.body?.job?.review === 0,
    `status ${c20.status} ${JSON.stringify(c20.body?.job)}`);
  const c21 = await fetch(`${APP}/api/import/jobs/${c0.body?.job?.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: spotifyUser }, body: JSON.stringify({ action: 'cancel' }),
  });
  check('C21 a finished import cannot be stopped', c21.status === 409, `status ${c21.status}`);

  // ── D. YouTube Music playlists ──
  const d1 = await post(ytUser, '/api/import/inspect', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberImport01' });
  check('D1 YT Music link inspects to ready tracks', d1.status === 200 && d1.body?.source === 'ytmusic' && d1.body?.name === 'Fake YT Music mix' &&
    d1.body?.tracks?.length === 3 && d1.body.tracks[0].id === 'youtube:ytmTrack001', `status ${d1.status} ${JSON.stringify(d1.body)?.slice(0, 200)}`);
  const d2 = await post(ytUser, '/api/import/inspect', { url: 'https://www.youtube.com/playlist?list=PLfakeEmberPrivate01' });
  check('D2 private YT playlist says so', d2.status === 403 && /private/i.test(d2.body?.error ?? ''), `status ${d2.status} ${d2.body?.error}`);
  const d3 = await post(ytUser, '/api/import/inspect', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberMissing01' });
  check('D3 unknown YT playlist is a 404', d3.status === 404 && /couldn't find/i.test(d3.body?.error ?? ''), `status ${d3.status} ${d3.body?.error}`);
  const d4 = await post(ytUser, '/api/import/jobs', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberImport01' });
  const d4done = d4.status === 201 ? await waitDone(ytUser, d4.body.job.id) : null;
  const d4pl = d4done ? await get(ytUser, `/api/playlists/${d4.body.playlistId}`) : null;
  check('D4 a YT Music import adds the playlist\'s own tracks, nothing to review', d4done?.job?.status === 'done' && d4done?.job?.accepted === 3 &&
    d4pl?.body?.tracks?.[0]?.id === 'youtube:ytmTrack001' && d4pl?.body?.tracks?.length === 3, `status ${d4.status} ${JSON.stringify(d4done?.job)}`);

  // ── E. Starting imports is rate limited per user ──
  const starts = [];
  for (let i = 0; i < 6; i++) starts.push((await post(ytUser, '/api/import/jobs', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberImport01' })).status);
  check('E1 the sixth start within ten minutes is a 429', starts.filter((s) => s === 201).length === 4 && starts[starts.length - 1] === 429,
    JSON.stringify(starts));
} finally {
  fake?.server.close();
  for (const id of created) {
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
