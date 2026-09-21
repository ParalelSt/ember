/** The phone player bar's size presets on /dizajn: the numbers the section
 *  quotes are the numbers the real bar measures.
 *
 *      node tests/phone-bar-sizes-ui.test.mjs     # or: npm run test:phone-bar-sizes
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD), opens /dizajn in a window wide
 *  enough that the three phone frames draw 1:1, and for every Bar size and
 *  Play style (set through the pickers' own localStorage keys) measures the
 *  REAL PhonePlayerBar in each frame: artwork, the visible play disc, the
 *  bare glyph, the hit box, the name and artist font sizes, the bar height
 *  and the name box at 390 and 360. Each must equal what the section's
 *  table quotes, the hit box must be at least 44px, and both play styles
 *  must share one hit box. MEASURE=1 prints the numbers as a
 *  PHONE_BAR_MEASURED literal; SHOT_DIR keeps screenshots of the 390 frame
 *  for every combination and of the 360 frame for the recommended one.
 *  Writes nothing. Needs the sandbox from tests/README.md. */
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
const SIZES = ['today', 'balanced', 'art', 'compact'];
const STYLES = ['disc', 'icon'];
const SIZE_KEY = 'dizajn-mobileplayer-size';
const STYLE_KEY = 'dizajn-mobileplayer-play-style';

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
 *  scale transform, if any, does not skew them), plus the section's table. */
function measure() {
  const section = document.querySelector('[data-testid="mobileplayer-section"]');
  const frames = {};
  for (const frame of section.querySelectorAll('[data-testid="mobileplayer-frame"]')) {
    const bar = frame.querySelector('[data-testid="phone-player-bar"]');
    const scale = bar.getBoundingClientRect().width / bar.offsetWidth;
    const btn = bar.querySelector('button');
    const disc = bar.querySelector('[data-testid="phone-play-disc"]');
    const svg = btn.querySelector('svg');
    const marquee = bar.querySelector('[data-testid="marquee"]');
    const artist = marquee.nextElementSibling;
    const art = bar.querySelector('[data-testid="phone-player-title-row"] > div');
    const bg = getComputedStyle(btn).backgroundColor;
    frames[frame.dataset.frame] = {
      size: bar.dataset.size,
      style: bar.dataset.playStyle,
      art: art.offsetWidth,
      artH: art.offsetHeight,
      hit: btn.offsetWidth,
      hitH: btn.offsetHeight,
      // Today's button is the disc itself; the presets draw one inside.
      disc: disc ? disc.offsetWidth : bg !== 'rgba(0, 0, 0, 0)' ? btn.offsetWidth : null,
      glyph: Math.round(svg.getBoundingClientRect().width / scale),
      title: parseFloat(getComputedStyle(marquee).fontSize),
      artist: parseFloat(getComputedStyle(artist).fontSize),
      bar: bar.offsetHeight,
      name: marquee.offsetWidth,
      scale: Math.round(scale * 1000) / 1000,
    };
  }
  const table = {};
  for (const row of section.querySelectorAll('[data-testid="mobileplayer-size-row"]')) {
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent.trim());
    table[row.dataset.size] = cells;
  }
  return { frames, table, recommended: section.querySelector('[data-testid="mobileplayer-recommended"]')?.textContent ?? '' };
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const measured = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });

  let recommended = null;
  for (const size of SIZES) {
    for (const style of STYLES) {
      await page.evaluate(([k1, v1, k2, v2]) => { localStorage.setItem(k1, v1); localStorage.setItem(k2, v2); },
        [SIZE_KEY, size, STYLE_KEY, style]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector(`[data-testid="mobileplayer-section"][data-size="${size}"][data-play-style="${style}"]`, { timeout: 20_000 });
      await page.waitForTimeout(400);
      const m = await page.evaluate(measure);
      const f390 = m.frames['clean-390'];
      const f360 = m.frames['android-360'];
      const tag = `${size} + ${style}`;
      check(`${tag}: every frame renders the chosen preset`, Object.values(m.frames).every((f) => f.size === size && f.style === style));
      check(`${tag}: frames draw 1:1`, Object.values(m.frames).every((f) => f.scale === 1), JSON.stringify(Object.values(m.frames).map((f) => f.scale)));
      check(`${tag}: artwork is square`, f390.art === f390.artH, `${f390.art}x${f390.artH}`);
      check(`${tag}: hit box at least 44px, square`, f390.hit >= 44 && f390.hit === f390.hitH, `${f390.hit}x${f390.hitH}`);
      if (style === 'icon') check(`${tag}: no disc drawn`, f390.disc === null);
      else check(`${tag}: disc drawn`, f390.disc !== null, String(f390.disc));
      const prev = measured[size] ?? {};
      measured[size] = {
        art: f390.art,
        play: style === 'disc' ? f390.disc : prev.play,
        glyph: style === 'icon' ? f390.glyph : prev.glyph,
        hit: f390.hit,
        title: f390.title,
        artist: f390.artist,
        bar: f390.bar,
        name390: f390.name,
        name360: f360.name,
      };
      if (style === 'icon') {
        check(`${size}: both play styles share one hit box`, prev.hit === f390.hit, `${prev.hit} vs ${f390.hit}`);
        check(`${size}: both play styles leave the same name box`, prev.name390 === f390.name, `${prev.name390} vs ${f390.name}`);
        const q = measured[size];
        const want = [String(q.art), `${q.play} / ${q.glyph}`, String(q.hit), `${q.title} / ${q.artist}`, String(q.bar), `${q.name390} / ${q.name360}`];
        const got = m.table[size]?.slice(1);
        check(`${size}: the section quotes what the DOM measures`, JSON.stringify(got) === JSON.stringify(want),
          `quoted ${JSON.stringify(got)}, measured ${JSON.stringify(want)}`);
      }
      if (!recommended) {
        const match = m.recommended.match(/Recommended: (.+?) \+ (.+?)\./);
        recommended = match ? { size: match[1], style: match[2] } : null;
      }

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        // The bar, the nav under it and a strip of the page above, from the
        // shell's bottom edge; scrolled into view first, since a clip
        // outside the viewport comes back cut.
        const shoot = async (frameId, file) => {
          const shell = page.locator(`[data-frame="${frameId}"] [data-testid="shell-preview"]`);
          await shell.scrollIntoViewIfNeeded();
          await page.evaluate(() => window.scrollBy(0, 200));
          const box = await shell.boundingBox();
          const footer = await page.locator(`[data-frame="${frameId}"] footer`).boundingBox();
          const top = footer.y - 100;
          await page.screenshot({ path: path.join(SHOTS, file),
            clip: { x: box.x, y: top, width: box.width, height: box.y + box.height - top } });
        };
        await shoot('clean-390', `${size}-${style}-390.png`);
        const names = { today: 'Today', balanced: 'Balanced', art: 'Art forward', compact: 'Compact' };
        const styleNames = { disc: 'Filled disc', icon: 'Icon only' };
        if (recommended && names[size] === recommended.size && styleNames[style] === recommended.style) {
          await shoot('android-360', `${size}-${style}-360-recommended.png`);
        }
      }
    }
  }
  check('the section names a Recommended combination', !!recommended, JSON.stringify(recommended));
  await ctx.close();
} finally {
  await browser.close();
}

if (process.env.MEASURE) {
  console.log('\nPHONE_BAR_MEASURED = {');
  for (const s of SIZES) {
    const m = measured[s];
    console.log(`  ${s}: { art: ${m.art}, play: ${m.play}, glyph: ${m.glyph}, hit: ${m.hit}, title: ${m.title}, artist: ${m.artist}, bar: ${m.bar}, name390: ${m.name390}, name360: ${m.name360} },`);
  }
  console.log('}');
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
