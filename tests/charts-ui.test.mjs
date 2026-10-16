/** Browser sim for "Popular now" and "Charts by genre" against the fake
 *  player (tests/fake-player.sh `trending` and `genre-charts`).
 *
 *      PB_URL=... PB_ADMIN_PASSWORD=... node tests/charts-ui.test.mjs
 *
 *  Starts its own `next start` from the existing build in apps/web (build
 *  it first with POCKETBASE_URL pointing at the sandbox PocketBase), with a
 *  fresh MUSIC_DIR so both chart caches start cold. Proves, in a real
 *  phone-sized browser:
 *   - C1: Home shows both rows, Popular now and Charts by genre (9 tiles,
 *     Balkan first)
 *   - C2: the Rock tile opens /chart/rock, ranked, "Updated daily"
 *   - C3: Play starts the chart's first song (the player shows it)
 *   - C4: the charts were fetched once, with one genre-charts call, and are
 *     mirrored to MUSIC_DIR/charts.json */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_URL, check, findChrome, finish, loadChromium, newMember, startApp, stopApp } from './genre-sim-harness.mjs';

const chromium = await loadChromium();
const SB = process.env.SB ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ember-charts-ui-'));
const MUSIC = path.join(SB, 'music');
const CALLS = path.join(SB, 'calls.log');
fs.mkdirSync(MUSIC, { recursive: true });

const member = await newMember('charts-ui');
const browser = await chromium.launch({ executablePath: findChrome() });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await context.addCookies([{ name: 'pb_auth', value: member.cookieValue, url: APP_URL }]);
const page = await context.newPage();

let app;
try {
  app = await startApp({ music: MUSIC, calls: CALLS });
  await page.goto(`${APP_URL}/`);
  const popular = page.getByRole('region', { name: 'Popular now' });
  const charts = page.getByRole('region', { name: 'Charts by genre' });
  await charts.waitFor({ timeout: 60000 });
  check('C1 Home shows Popular now', await popular.isVisible());
  const tiles = charts.locator('[data-chart-tile]');
  const names = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('C1 Charts by genre has 9 tiles, Balkan first', names.length === 9 && names[0] === 'Balkan chart', JSON.stringify(names));

  await charts.getByRole('link', { name: 'Rock chart' }).click();
  await page.waitForURL('**/chart/rock');
  await page.getByRole('heading', { level: 1, name: 'Rock' }).waitFor({ timeout: 20000 });
  const meta = await page.getByTestId('collection-meta').textContent();
  check('C2 the Rock chart page opens, fresh', meta === '12 songs · Updated daily', meta ?? '');
  check('C2 its first row is the chart\'s number 1', await page.getByText('Rock Song 01').first().isVisible());

  const stream = page.waitForRequest((r) => r.url().includes('/api/youtube/stream/rock0100000'), { timeout: 20000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  check('C3 Play starts the first song (its stream is asked for)', await stream);

  const calls = fs.readFileSync(CALLS, 'utf8').split('\n').filter((l) => l.startsWith('genre-charts')).length;
  check('C4 one genre-charts call, mirrored', calls === 1 && fs.existsSync(path.join(MUSIC, 'charts.json')), `${calls} call(s)`);
} catch (e) {
  check('run', false, e.message);
} finally {
  if (app) await stopApp(app);
  await browser.close();
}
finish();
