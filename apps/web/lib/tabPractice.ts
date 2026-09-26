/** The tab page's practice tools:
 *  a loop over a range of bars or a section, and a slower playback speed.
 *  Pure arithmetic over the tab timeline (lib/tabTimeline.ts); the page
 *  turns tab time into song time and does the seeking. */

import type { TabTimeline } from '@/lib/tabTimeline';

// ── speed ─────────────────────────────────────────────────────────────────

/** Slowest and fastest speeds offered: half speed for a hard passage, a
 *  little over full speed to get ahead of it. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 1.25;

/** The speed buttons, in percent. */
export const SPEED_PRESETS = [50, 60, 70, 75, 80, 90, 100] as const;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;
}

export function rateFromPercent(percent: number): number {
  return clampRate(percent / 100);
}

/** The speed that plays the tab at `bpm` when it is written at `tabBpm`. */
export function rateFromBpm(bpm: number, tabBpm: number | null): number | null {
  if (!tabBpm || !(tabBpm > 0) || !(bpm > 0)) return null;
  return clampRate(bpm / tabBpm);
}

/** The tempo heard at `rate`: 120 bpm at 75% is 90. */
export function bpmAtRate(tabBpm: number | null, rate: number): number | null {
  return tabBpm && tabBpm > 0 ? Math.round(tabBpm * rate) : null;
}

// ── loop ──────────────────────────────────────────────────────────────────

/** A stretch of bars to loop, by score bar index (0-based, inclusive). */
export interface BarRange {
  start: number;
  end: number;
}

/** A section marker and the bars it covers, up to the next marker. */
export interface SectionRange extends BarRange {
  name: string;
}

/** The score's bar count (the highest bar index plus one). */
export function barCount(timeline: TabTimeline): number {
  return timeline.bars.reduce((n, b) => Math.max(n, b.index + 1), 0);
}

/** The sections of the tab as its markers split it, in score order. A
 *  section played twice (a repeat) is listed once. */
export function sectionRanges(timeline: TabTimeline): SectionRange[] {
  const count = barCount(timeline);
  const starts = new Map<number, string>();
  for (const b of timeline.bars) if (b.section && !starts.has(b.index)) starts.set(b.index, b.section);
  const sorted = [...starts.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.map(([start, name], i) => ({ name, start, end: (sorted[i + 1]?.[0] ?? count) - 1 }));
}

/** The range with its ends in order and inside the score, or null. */
export function normalizeRange(range: BarRange | null, timeline: TabTimeline): BarRange | null {
  if (!range) return null;
  const count = barCount(timeline);
  if (count === 0) return null;
  let a = Math.round(range.start);
  let b = Math.round(range.end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > b) [a, b] = [b, a];
  a = Math.max(0, Math.min(count - 1, a));
  b = Math.max(0, Math.min(count - 1, b));
  return { start: a, end: b };
}

/** Where the loop runs on the tab clock: from the first time its first bar
 *  is played to the end of its last bar played after that (a range inside
 *  a repeat loops its first pass). Null when the timeline has no such
 *  bars. */
export function loopSpanMs(timeline: TabTimeline, range: BarRange | null): { startMs: number; endMs: number } | null {
  const r = normalizeRange(range, timeline);
  if (!r) return null;
  const from = timeline.bars.findIndex((b) => b.index === r.start);
  if (from < 0) return null;
  let to = -1;
  for (let i = from; i < timeline.bars.length; i++) {
    if (timeline.bars[i].index === r.end) {
      to = i;
      break;
    }
  }
  if (to < 0) return null;
  const startMs = timeline.bars[from].startMs;
  const endMs = timeline.bars[to].endMs;
  return endMs > startMs ? { startMs, endMs } : null;
}

/** How far before the loop's start the playhead may be and still count as
 *  in the loop (the player's reports wobble), in seconds. */
const LOOP_SLACK_SEC = 0.5;

/** Where to jump, if anywhere, for a loop over [startSec, endSec) of the
 *  song: back to the start when the playhead ran from inside the loop over
 *  its end. A playhead that the listener moved elsewhere (a seek outside
 *  the loop) is left alone, so the loop never traps them. */
export function loopJump(prevSec: number | null, sec: number, span: { startSec: number; endSec: number }): number | null {
  if (prevSec === null || !(span.endSec > span.startSec)) return null;
  const wasInside = prevSec >= span.startSec - LOOP_SLACK_SEC && prevSec < span.endSec;
  const crossed = sec >= span.endSec;
  // Running on, not a jump: a crossing within a second of the last look.
  const ranOn = sec - prevSec >= 0 && sec - prevSec < 1;
  return wasInside && crossed && ranOn ? span.startSec : null;
}

/** "Bars 5-12", "Bar 3". 1-based, as a listener counts. */
export function rangeLabel(range: BarRange): string {
  return range.start === range.end ? `Bar ${range.start + 1}` : `Bars ${range.start + 1}–${range.end + 1}`;
}

/** Two clicks on the tab make a range: the first picks a bar, the second
 *  closes the range there (either way round). A third starts over. */
export function pickBar(picking: number | null, bar: number): { picking: number | null; range: BarRange | null } {
  if (picking === null) return { picking: bar, range: null };
  return { picking: null, range: { start: Math.min(picking, bar), end: Math.max(picking, bar) } };
}
