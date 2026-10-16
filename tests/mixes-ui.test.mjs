/** Browser sim for "Your mixes" against the fake player
 *  (tests/fake-player.sh `radio-batch`, `genre-charts`), no Last.fm or
 *  MusicBrainz (GENRES_LOOKUP_DISABLED=1: genres come from the rows seeded
 *  here, the "fixture tags").
 *
 *      PB_URL=... PB_ADMIN_PASSWORD=... node tests/mixes-ui.test.mjs
 *
 *  Starts its own `next start` from the existing build in apps/web (build
 *  it first with POCKETBASE_URL pointing at the sandbox PocketBase). Seeds a
 *  member who played six rock bands and four pop acts, artist_genres rows
 *  for them and for the radio's new artists, and a radio fixture that leaks
 *  pop into rock radio. Proves, in a phone-sized browser:
 *   - M1: opening Home starts a build (lazy trigger) and the Your mixes row
 *     turns up with two Radio cards, Rock & Metal first
 *   - M2: the rock mix has no pop song in it (purity end to end)
 *   - M3: the card opens /mix/rock-metal, "Built today from ..."
 *   - M4: Play starts the mix's first song */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_URL, PB_URL, adminToken, check, findChrome, finish, loadChromium, newMember, sleep, startApp, stopApp } from './genre-sim-harness.mjs';

const chromium = await loadChromium();
const SB = process.env.SB ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ember-mixes-ui-'));
const MUSIC = path.join(SB, 'music');
const CALLS = path.join(SB, 'calls.log');
const RADIO = path.join(SB, 'radio.json');
fs.mkdirSync(MUSIC, { recursive: true });

const su = await adminToken();
const pb = (method, p, body) => fetch(PB_URL + p, { method, headers: { 'content-type': 'application/json', Authorization: su }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`); return r.json(); });
const tag = Date.now().toString(36).slice(-5);
const vid = (s) => `${s}${tag}`.replace(/[^A-Za-z0-9]/g, '').padEnd(11, '0').slice(0, 11);

const rockBands = Array.from({ length: 6 }, (_, i) => `Sim Rock ${tag} ${i}`);
const popActs = Array.from({ length: 4 }, (_, i) => `Sim Pop ${tag} ${i}`);
const newRock = Array.from({ length: 24 }, (_, i) => `Sim New Rock ${tag} ${i}`);
const newPop = Array.from({ length: 12 }, (_, i) => `Sim New Pop ${tag} ${i}`);
const key = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const member = await newMember('mixes-ui');
const own = [];
for (const [list, fam] of [[rockBands, 'rock-metal'], [popActs, 'pop']]) {
  for (const [i, band] of list.entries()) {
    for (let j = 0; j < 4; j++) {
      const id = vid(`${fam[0]}${i}${j}`);
      const t = await pb('POST', '/api/collections/tracks/records', {
        external_id: `youtube:${id}`, source: 'youtube', source_id: id, title: `${band} Song ${j}`, artist: band,
        artwork_url: '', stream_url: `/api/youtube/stream/${id}`, duration_sec: 200,
      });
      own.push({ id, fam, band });
      for (let k = 0; k < (fam === 'pop' ? 1 : 2); k++) {
        await pb('POST', '/api/collections/plays/records', { user: member.id, track: t.id, played_at: new Date(Date.now() - (k + 1) * 3600e3).toISOString().replace('T', ' ') });
      }
    }
  }
}
// The fixture tags: every artist the sim uses, as manual rows.
for (const [list, family] of [[rockBands, 'rock-metal'], [newRock, 'rock-metal'], [popActs, 'pop'], [newPop, 'pop']]) {
  for (const name of list) {
    await pb('POST', '/api/collections/artist_genres/records', { artist_key: key(name), name, family, families: { [family]: 1 }, source: 'manual', status: 'found', fetched_at: new Date().toISOString() });
  }
}
// Every seed's radio: its own family, with one song in three from the other.
const radio = {};
for (const o of own) {
  const same = o.fam === 'pop' ? newPop : newRock;
  const other = o.fam === 'pop' ? newRock : newPop;
  radio[o.id] = Array.from({ length: 30 }, (_, i) => {
    const artist = i % 3 === 2 ? other[i % other.length] : same[i % same.length];
    return { videoId: vid(`r${o.id.slice(0, 4)}${i}`), title: `${artist} Radio ${i}`, artist, artworkUrl: '', durationSec: 200 };
  });
}
fs.writeFileSync(RADIO, JSON.stringify(radio));

const browser = await chromium.launch({ executablePath: findChrome() });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await context.addCookies([{ name: 'pb_auth', value: member.cookieValue, url: APP_URL }]);
const page = await context.newPage();
const cookie = `pb_auth=${member.cookieValue}`;

let app;
try {
  app = await startApp({ music: MUSIC, calls: CALLS, env: { FAKE_RADIO_FIXTURE: RADIO } });
  await page.goto(`${APP_URL}/`);
  const row = page.getByRole('region', { name: 'Your mixes' });
  await row.waitFor({ timeout: 90000 });
  const cards = await row.locator('[data-mix-card]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('M1 Your mixes shows two Radio cards, Rock & Metal first', cards.length === 2 && cards[0] === 'Rock & Metal Mix', JSON.stringify(cards));

  const rock = await fetch(`${APP_URL}/api/mixes/rock-metal`, { headers: { cookie } }).then((r) => r.json());
  const pop = new Set([...popActs, ...newPop]);
  const leaks = (rock.tracks ?? []).filter((t) => pop.has(t.artist));
  check('M2 the rock mix has no pop song', (rock.tracks?.length ?? 0) >= 20 && leaks.length === 0, `${rock.tracks?.length} songs, ${leaks.length} pop`);

  await row.getByRole('link', { name: 'Rock & Metal Mix' }).click();
  await page.waitForURL('**/mix/rock-metal');
  const built = await page.getByTestId('mix-built').textContent({ timeout: 20000 });
  check('M3 the mix page opens, built today', /^Built today from /.test(built ?? ''), built ?? '');

  const first = rock.tracks?.[0]?.sourceId ?? 'none';
  const stream = page.waitForRequest((r) => r.url().includes(`/api/youtube/stream/${first}`), { timeout: 20000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  check('M4 Play starts the first song', await stream, first);
} catch (e) {
  check('run', false, e.message);
} finally {
  if (app) await stopApp(app);
  await browser.close();
  await sleep(0);
}
finish();
