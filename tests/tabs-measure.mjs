/** Measuring helpers shared by the tab page browser tests
 *  (tests/tabs-sync.test.mjs, tests/tabs-text.test.mjs): where the playhead
 *  line is, which bar it is in, and the real playback time underneath.
 *
 *  The real time needs `installAudioProbe` on the browser context before the
 *  page loads: the web playback backend builds a plain `new Audio()` that is
 *  never attached to the DOM, so the probe keeps a reference to it. */

/** Test-only instrumentation, no product code touched. */
export async function installAudioProbe(ctx) {
  await ctx.addInitScript(() => {
    const Native = window.Audio;
    window.__audios = [];
    const Wrapped = function (...args) {
      const el = new Native(...args);
      window.__audios.push(el);
      return el;
    };
    Wrapped.prototype = Native.prototype;
    window.Audio = Wrapped;
  });
}

/** Real playback time, seconds, read from the actual (detached) audio
 *  element the web backend drives, sub-second precision, not the
 *  1-second-rounded position the store/footer shows. */
export const realTime = (page) =>
  page.evaluate(() => {
    const a = window.__audios?.[window.__audios.length - 1];
    return a ? a.currentTime : null;
  });
export const realDuration = (page) =>
  page.evaluate(() => {
    const a = window.__audios?.[window.__audios.length - 1];
    return a && Number.isFinite(a.duration) ? a.duration : null;
  });

/** Every bar-number label AlphaTab draws (its distinctive muted grey
 *  fill), in viewport pixels: {n, x, y}. All 32 exist in the DOM at once
 *  (Page layout is not virtualised), only their visibility changes with
 *  scroll, which is exactly what "follows the song" is checking. */
export const barLabels = (page) =>
  page.evaluate(() => {
    const texts = [...document.querySelectorAll('[data-testid="tab-score"] text')];
    return texts
      .filter((t) => /^rgba\(156,\s*158,\s*162/.test(t.getAttribute('fill') || '') && /^\d+$/.test(t.textContent?.trim() || ''))
      .map((t) => {
        const r = t.getBoundingClientRect();
        return { n: Number(t.textContent.trim()), x: r.x, y: r.y };
      });
  });

export const cursorRect = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.at-cursor-beat');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

/** The visible band the cursor must stay in: below the sticky toolbar,
 *  above the player bar (docs/tabs-rebuild.md section 4, followScroll). */
export const viewBand = (page) =>
  page.evaluate(() => {
    const sticky = document.querySelector('[data-testid="tabs-sticky"]')?.getBoundingClientRect();
    const foot = document.querySelector('footer')?.getBoundingClientRect();
    return { top: sticky ? sticky.bottom : 0, bottom: foot ? foot.top : window.innerHeight };
  });

/** Row-cluster the bar labels around `y`, sorted left to right: AlphaTab
 *  wraps bars into rows (vertical) or draws one long row (horizontal). */
export function rowAt(labels, y) {
  if (labels.length === 0) return [];
  let nearest = labels[0];
  for (const l of labels) if (Math.abs(l.y - y) < Math.abs(nearest.y - y)) nearest = l;
  return labels.filter((l) => Math.abs(l.y - nearest.y) < 40).sort((a, b) => a.x - b.x);
}

/** Where the cursor is, as a fractional bar number (10.3 = 30% into bar
 *  10), by interpolating between the two bar-number labels either side
 *  of it on its row. Falls back to the bar's own number (no fraction) at
 *  the edges. */
export function barPositionFromCursor(labels, cursor, rowRight = null) {
  // The cursor rect spans the full staff height; its vertical centre sits
  // more reliably inside its own row than its top edge does near a row
  // boundary.
  const row = rowAt(labels, cursor.y + (cursor.h ?? 0) / 2);
  if (row.length === 0) return null;
  let loIdx = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i].x <= cursor.x + 1) loIdx = i;
    else break;
  }
  const lo = row[loIdx];
  const hi = row[loIdx + 1];
  // The last bar of a row has no next label to interpolate against. Bar
  // widths vary a lot with note density (a bar of straight quarter notes
  // vs. a bar of sixteenths), so falling back to just the previous pair's
  // width is noisy; the row's average bar width is a steadier estimate
  // for how far the last bar likely extends.
  let width = hi ? hi.x - lo.x : null;
  if (!width && row.length > 1) {
    width = (row[row.length - 1].x - row[0].x) / (row.length - 1);
  }
  // One bar to a row (a phone): it runs to the score's right edge.
  if (!width && row.length === 1 && rowRight !== null) width = rowRight - lo.x;
  if (width && width > 0) {
    const frac = Math.max(0, Math.min(1, (cursor.x - lo.x) / width));
    return lo.n + frac;
  }
  return lo.n;
}
