/** The phone player bar's shipped sizes, as the /dizajn gallery draws them:
 *  the numbers the "Mobile player" section quotes are the numbers the real
 *  bar measures in its frames.
 *
 *      node tests/phone-bar-sizes-ui.test.mjs     # or: npm run test:phone-bar-sizes
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD), opens /dizajn in a window wide
 *  enough that the three phone frames draw 1:1, and measures the REAL
 *  PhonePlayerBar in each frame: the artwork (56), the play hit box (48)
 *  and the visible disc inside it (40, glyph 20), the name and artist font
 *  sizes (16 / 14), the bar height and the name box at 390 and 360. The
 *  bar height and name boxes must equal what the section quotes. The size
 *  pickers are gone: a choice they saved in localStorage changes nothing,
 *  and no Bar size / Play style radiogroup or size table is left.
 *  SHOT_DIR keeps a screenshot of the 390 and 360 frames. Writes nothing.
 *  Needs the sandbox from tests/README.md. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const EMAIL = process.env.EMBER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.EMBER_PASSWORD ?? 'EmberTest2026!';
const SHOTS = process.env.SHOT_DIR ?? '';
// What ships (Balanced, with a smaller play disc), in CSS px.
const WANT = { art: 56, disc: 40, glyph: 20, hit: 48, title: 16, artist: 14 };
// The keys the removed Bar size / Play style pickers saved under.
const OLD_KEYS = ['dizajn-mobileplayer-size', 'dizajn-mobileplayer-play-style'];

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

const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
}).then((r) => { if (!r.ok) throw new Error(`sign-in failed: ${r.status}`); return r.json(); });
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

/** Every frame's bar, measured in layout px (offset sizes, so the frame's
 *  scale transform, if any, does not skew them), plus the section's copy. */
function measure() {
  const section = document.querySelector('[data-testid="mobileplayer-section"]');
  const frames = {};
  for (const frame of section.querySelectorAll('[data-testid="mobileplayer-frame"]')) {
    const bar = frame.querySelector('[data-testid="phone-player-bar"]');
    const scale = bar.getBoundingClientRect().width / bar.offsetWidth;
    const btns = bar.querySelectorAll('button');
    const btn = btns[0];
    const disc = bar.querySelector('[data-testid="phone-play-disc"]');
    const svg = btn.querySelector('svg');
    const marquee = bar.querySelector('[data-testid="marquee"]');
    const artist = marquee.nextElementSibling;
    const art = bar.querySelector('[data-testid="phone-player-title-row"] > div');
    frames[frame.dataset.frame] = {
      buttons: btns.length,
      marked: 'size' in bar.dataset || 'playStyle' in bar.dataset,
      art: art.offsetWidth,
      artH: art.offsetHeight,
      hit: btn.offsetWidth,
      hitH: btn.offsetHeight,
      disc: disc ? disc.offsetWidth : null,
      discH: disc ? disc.offsetHeight : null,
      glyph: Math.round(svg.getBoundingClientRect().width / scale),
      title: parseFloat(getComputedStyle(marquee).fontSize),
      artist: parseFloat(getComputedStyle(artist).fontSize),
      bar: bar.offsetHeight,
      name: marquee.offsetWidth,
      scale: Math.round(scale * 1000) / 1000,
    };
  }
  const groups = [...document.querySelectorAll('[role="radiogroup"]')].map((g) => g.getAttribute('aria-label'));
  return {
    frames,
    taps: section.querySelector('[data-testid="mobileplayer-taps"]')?.textContent ?? '',
    table: !!section.querySelector('[data-testid="mobileplayer-sizes"]'),
    recommended: !!section.querySelector('[data-testid="mobileplayer-recommended"]'),
    groups,
  };
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
  // A choice the removed pickers saved must not reach the bar.
  await page.evaluate((keys) => { localStorage.setItem(keys[0], 'art'); localStorage.setItem(keys[1], 'icon'); }, OLD_KEYS);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="mobileplayer-section"] [data-testid="phone-player-bar"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);

  check('the Bar size and Play style pickers are gone',
    !m.groups.includes('Bar size') && !m.groups.includes('Play style'), JSON.stringify(m.groups));
  check('the size table and the Recommended note are gone', !m.table && !m.recommended);
  const ids = Object.keys(m.frames);
  check('three frames, each drawing the bar', JSON.stringify(ids) === JSON.stringify(['clean-390', 'android-390', 'android-360']),
    JSON.stringify(ids));
  for (const [id, f] of Object.entries(m.frames)) {
    check(`${id}: draws 1:1`, f.scale === 1, String(f.scale));
    check(`${id}: play and next, no size or style marker`, f.buttons === 2 && !f.marked, `${f.buttons} buttons`);
    const got = { art: f.art, disc: f.disc, glyph: f.glyph, hit: f.hit, title: f.title, artist: f.artist };
    check(`${id}: the shipped sizes`, JSON.stringify(got) === JSON.stringify(WANT),
      `got ${JSON.stringify(got)}`);
    check(`${id}: artwork, hit box and disc are square`,
      f.art === f.artH && f.hit === f.hitH && f.disc === f.discH, `${f.artH} ${f.hitH} ${f.discH}`);
  }
  const f390 = m.frames['clean-390'];
  const f360 = m.frames['android-360'];
  console.log(`measured: bar ${f390.bar}px, name box ${f390.name} at 390, ${f360.name} at 360`);
  check('the section quotes the measured name boxes',
    m.taps.includes(`${f390.name}px at 390, ${f360.name}px at 360`), m.taps);
  check('the section quotes the measured bar height', m.taps.includes(`Bar height: ${f390.bar}px`), m.taps);
  check('the section quotes the 40px disc in the 48px hit box, next, artwork 56',
    m.taps.includes('play 48px (a 40px disc inside it), next 48px (24px glyph), artwork 56px'), m.taps);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    // The bar, the nav under it and a strip of the page above, from the
    // shell's bottom edge; scrolled into view first, since a clip outside
    // the viewport comes back cut.
    for (const frameId of ['clean-390', 'android-360']) {
      const shell = page.locator(`[data-frame="${frameId}"] [data-testid="shell-preview"]`);
      await shell.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 200));
      const box = await shell.boundingBox();
      const footer = await page.locator(`[data-frame="${frameId}"] footer`).boundingBox();
      const top = footer.y - 100;
      await page.screenshot({ path: path.join(SHOTS, `gallery-${frameId}.png`),
        clip: { x: box.x, y: top, width: box.width, height: box.y + box.height - top } });
    }
  }
  await ctx.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
