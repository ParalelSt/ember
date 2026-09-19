/** Playlist import, stages 1 and 2 (docs/imports.md): the Spotify embed-page
 *  source, YouTube Music playlists, and the scored match split.
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

  // ── C. Matching: every item comes back scored, split three ways ──
  const results = [];
  for (let i = 0; i < items.length; i += 8) {
    const r = await post(spotifyUser, '/api/import/match', { items: items.slice(i, i + 8) });
    if (r.status !== 200) {
      check(`C0 match batch at ${i}`, false, `status ${r.status} ${JSON.stringify(r.body)}`);
      break;
    }
    results.push(...r.body.results);
  }
  const by = (status) => results.filter((r) => r.status === status).map((r) => r.item.position);
  check('C1 one result per item, in order', results.length === 50 && results.every((r, i) => r.item.position === i), `count ${results.length}`);
  check('C2 accepted: 0, 1, 3, 5', JSON.stringify(by('accepted')) === '[0,1,3,5]', JSON.stringify(by('accepted')));
  check('C3 needs review: 2 (live version), 4 (fan upload)', JSON.stringify(by('review')) === '[2,4]', JSON.stringify(by('review')));
  check('C4 not found: the other 44', by('missing').length === 44, `${by('missing').length}`);

  const r0 = results[0];
  check('C5 accepted match carries the source item and every candidate', r0?.item?.title === 'Bass Persuades' && r0?.candidates?.length === 2,
    JSON.stringify(r0?.candidates?.map((c) => c.track.title)));
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
  check('C13 accepted tracks are ready to add', results.filter((r) => r.status === 'accepted')
    .every((r) => r.candidates[0].track.streamUrl === `/api/youtube/stream/${r.candidates[0].track.sourceId}`));

  const c14 = await post(spotifyUser, '/api/import/match', { items: items.slice(0, 9) });
  check('C14 more than 8 items is refused', c14.status === 400, `status ${c14.status}`);
  const c15 = await fetch(`${APP}/api/import/match`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: items.slice(0, 1) }),
  });
  // The proxy sends signed-out API calls to the sign-in page.
  check('C15 signed out never matches', c15.status === 401 || (c15.status === 307 && /\/auth\?/.test(c15.headers.get('location') ?? '')),
    `status ${c15.status}`);

  // ── D. YouTube Music playlists ──
  const d1 = await post(ytUser, '/api/import/inspect', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberImport01' });
  check('D1 YT Music link inspects to ready tracks', d1.status === 200 && d1.body?.source === 'ytmusic' && d1.body?.name === 'Fake YT Music mix' &&
    d1.body?.tracks?.length === 3 && d1.body.tracks[0].id === 'youtube:ytmTrack001', `status ${d1.status} ${JSON.stringify(d1.body)?.slice(0, 200)}`);
  const d2 = await post(ytUser, '/api/import/inspect', { url: 'https://www.youtube.com/playlist?list=PLfakeEmberPrivate01' });
  check('D2 private YT playlist says so', d2.status === 403 && /private/i.test(d2.body?.error ?? ''), `status ${d2.status} ${d2.body?.error}`);
  const d3 = await post(ytUser, '/api/import/inspect', { url: 'https://music.youtube.com/playlist?list=PLfakeEmberMissing01' });
  check('D3 unknown YT playlist is a 404', d3.status === 404 && /couldn't find/i.test(d3.body?.error ?? ''), `status ${d3.status} ${d3.body?.error}`);
} finally {
  fake?.server.close();
  for (const id of created) {
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
