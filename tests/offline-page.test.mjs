/** The bundled cold-start page (apps/mobile/public/offline.html).
 *
 *      node tests/offline-page.test.mjs      # or: npm run test:offline-page
 *
 *  The page ships inside the APK and is shown by Capacitor's server.errorPath
 *  when the live server cannot be reached, so it must work from the plugin
 *  alone. No server and no phone here: the file is loaded over file:// with a
 *  fake `Capacitor` (EmberOffline + MediaSession + convertFileSrc) injected
 *  before it runs, which is exactly the surface the real shell gives it.
 *  The emulator run in the task report covers the real bridge. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'apps', 'mobile', 'public', 'offline.html');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache: set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found: set CHROME_PATH');
}

// Where "Try again" should land. A real file so the navigation can be observed.
const serverStub = path.join(os.tmpdir(), `ember-offline-server-${process.pid}.html`);
fs.writeFileSync(serverStub, '<title>Server</title><h1>THE SERVER UI</h1>');

let pass = 0, fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--allow-file-access-from-files'] });

/** One page with the fake plugin injected. `pins`/`files` shape the status. */
async function open({ plugin = true, pins, files } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(({ plugin, pins, files, serverUrl }) => {
    window.__calls = [];
    if (!plugin) return;                    // no plugin: the fallback path
    const tracksById = {
      p1: [
        { id: 't1', title: 'First Song', artist: 'Artist One' },
        { id: 't2', title: 'Second Song', artist: 'Artist Two' },
        { id: 't3', title: 'Undownloaded', artist: 'Artist Three' },
      ],
      p2: [{ id: 't4', title: 'Liked Song', artist: 'Artist Four' }],
    };
    window.Capacitor = {
      convertFileSrc: (p) => `capfile://${p}`,
      Plugins: {
        EmberOffline: {
          status: async () => ({ pins, trackFiles: files, totalBytes: 1 }),
          tracks: async ({ id }) => ({ tracks: tracksById[id] ?? [] }),
          serverUrl: async () => ({ url: serverUrl }),
        },
        MediaSession: {
          setMetadata: async (o) => { window.__calls.push(['meta', o.title]); },
          setPlaybackState: async (o) => { window.__calls.push(['state', o.playbackState]); },
          setActionHandler: async (o, cb) => { (window.__handlers ??= {})[o.action] = cb; },
        },
      },
    };
  }, { plugin, pins, files, serverUrl: `file://${serverStub}` });
  const page = await ctx.newPage();
  // Nothing here needs real decoding, and a fake path would stall on load.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this.__playing; } });
    HTMLMediaElement.prototype.play = function () { this.__playing = true; this.dispatchEvent(new Event('play')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.__playing = false; this.dispatchEvent(new Event('pause')); };
  });
  await page.goto(`file://${PAGE}`);
  return { ctx, page };
}

const twoPins = {
  pins: [
    { id: 'p1', name: 'Roadtrip', total: 3, done: 2, failed: 0, downloading: false },
    { id: 'p2', name: 'Liked songs', total: 1, done: 0, failed: 0, downloading: false },
  ],
  files: { t1: '/data/offline/t1.m4a', t2: '/data/offline/t2.m4a' },
};

// 1. Pins with downloads render; a pin with done === 0 does not.
{
  const { ctx, page } = await open(twoPins);
  const text = await page.locator('body').innerText();
  check('the header says Offline', text.includes('Offline'));
  check('the pin is listed by name with a count', text.includes('Roadtrip') && text.includes('2 songs'));
  check('only downloaded tracks are rows', (await page.locator('.row').count()) === 2);
  check('an undownloaded track is left out', !text.includes('Undownloaded'));
  check('a pin with nothing downloaded is left out', !text.includes('Liked songs'));

  // 2. Tapping a row plays it from the local file, with session metadata.
  await page.locator('.row').first().click();
  const src = await page.locator('audio').evaluate((a) => a.src);
  check('the row plays the local file through convertFileSrc', src === 'capfile:///data/offline/t1.m4a');
  check('the now-playing bar shows the track', (await page.locator('#nowTitle').innerText()) === 'First Song');
  const calls = await page.evaluate(() => window.__calls);
  check('the native media session gets the metadata', calls.some(([k, v]) => k === 'meta' && v === 'First Song'));
  check('the native media session goes to playing', calls.some(([k, v]) => k === 'state' && v === 'playing'));

  // 3. Next, previous and the lock-screen handlers move within the pin.
  await page.locator('#next').click();
  check('next plays the second track', (await page.locator('#nowTitle').innerText()) === 'Second Song');
  await page.locator('#prev').click();
  check('previous goes back', (await page.locator('#nowTitle').innerText()) === 'First Song');
  await page.evaluate(() => window.__handlers.nexttrack());
  check('the lock-screen next handler advances', (await page.locator('#nowTitle').innerText()) === 'Second Song');
  await page.evaluate(() => window.__handlers.previoustrack());
  check('the lock-screen previous handler goes back', (await page.locator('#nowTitle').innerText()) === 'First Song');
  await page.evaluate(() => window.__handlers.nexttrack());
  await page.evaluate(() => window.__handlers.nexttrack());
  check('next stops at the end of the pin', (await page.locator('#nowTitle').innerText()) === 'Second Song');

  // 4. A finished track auto-advances.
  await page.evaluate(() => window.__handlers.previoustrack());
  await page.locator('audio').evaluate((a) => a.dispatchEvent(new Event('ended')));
  check('a finished track advances to the next', (await page.locator('#nowTitle').innerText()) === 'Second Song');

  // 5. Pause and play keep the button and the session in step.
  await page.locator('#toggle').click();
  check('pausing updates the button', (await page.locator('#toggle').innerText()) === '▶');
  const after = await page.evaluate(() => window.__calls);
  check('pausing tells the native session', after.some(([k, v]) => k === 'state' && v === 'paused'));

  // 6. A file that will not play says so instead of failing silently.
  await page.locator('audio').evaluate((a) => a.dispatchEvent(new Event('error')));
  check('an unplayable download is reported', (await page.locator('#nowArtist').innerText()).includes('could not be played'));

  // 7. Try again goes to the server URL the plugin reports.
  await Promise.all([page.waitForURL(`file://${serverStub}`), page.getByRole('button', { name: 'Try again' }).click()]);
  check('Try again loads the server URL', (await page.locator('h1').innerText()) === 'THE SERVER UI');
  await ctx.close();
}

// 8. Nothing downloaded at all: a plain explanation, no empty sections.
{
  const { ctx, page } = await open({ pins: [], files: {} });
  const text = await page.locator('body').innerText();
  check('with no pins the page says so', text.includes('Nothing downloaded yet'));
  check('with no pins there are no rows', (await page.locator('.row').count()) === 0);
  await ctx.close();
}

// 9. No plugin (the page opened outside the shell): the old fallback copy.
{
  const { ctx, page } = await open({ plugin: false });
  const text = await page.locator('body').innerText();
  check('without the plugin it falls back to Connecting to server', text.includes('Connecting to server'));
  await ctx.close();
}

// 10. The copy carries no em dashes (repo rule) and the page stays small.
{
  const source = fs.readFileSync(PAGE, 'utf8');
  check('no em dashes in the page', !source.includes('—'));
  check('the page is one small file', source.split('\n').length < 260);
}

await browser.close();
fs.rmSync(serverStub, { force: true });
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
