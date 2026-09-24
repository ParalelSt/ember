/** The tab's own timeline for the practice tools (docs/tabs-rebuild.md
 *  section 4, stage 4): its bars in playing order with their time
 *  signatures, section markers and tempo, read once from AlphaTab's tick
 *  lookup, and the beats a metronome clicks on. Pure data and arithmetic;
 *  the page turns tab time into song time through lib/tabSync.ts. */

import { tempoMap, tickToMs, TICKS_PER_QUARTER, type TempoChange } from '@/lib/tabSync';

/** One bar as it is played (a bar inside a repeat appears once per pass). */
export interface TimelineBar {
  /** The bar's index in the score (what the listener sees numbered, from 0). */
  index: number;
  startTick: number;
  endTick: number;
  /** On the tab's clock (ms from the top of the score). */
  startMs: number;
  endMs: number;
  numerator: number;
  denominator: number;
  /** The section marker that starts here ("Intro", "Chorus"), if any. */
  section: string | null;
}

export interface TabTimeline {
  bars: TimelineBar[];
  tempos: TempoChange[];
}

/** The pieces of AlphaTab's MasterBarTickLookup read here. */
export interface MasterBarLookup {
  start: number;
  end?: number;
  tempoChanges?: { tick: number; tempo: number }[];
  masterBar?: {
    index?: number;
    timeSignatureNumerator?: number;
    timeSignatureDenominator?: number;
    section?: { text?: string; marker?: string } | null;
  };
}

/** `api.tickCache.masterBars` to a timeline. Bars without an end (an old
 *  AlphaTab, a fake) end where the next one starts, or after one bar of
 *  their signature. */
export function buildTimeline(masterBars: MasterBarLookup[]): TabTimeline {
  const tempos = tempoMap(masterBars);
  const bars: TimelineBar[] = masterBars.map((mb, i) => {
    const m = mb.masterBar ?? {};
    const numerator = Number(m.timeSignatureNumerator) > 0 ? Number(m.timeSignatureNumerator) : 4;
    const denominator = Number(m.timeSignatureDenominator) > 0 ? Number(m.timeSignatureDenominator) : 4;
    const full = numerator * ((TICKS_PER_QUARTER * 4) / denominator);
    const next = masterBars[i + 1]?.start;
    const endTick = typeof mb.end === 'number' && mb.end > mb.start ? mb.end : typeof next === 'number' && next > mb.start ? next : mb.start + full;
    const text = String(m.section?.text || m.section?.marker || '').trim();
    return {
      index: typeof m.index === 'number' ? m.index : i,
      startTick: mb.start,
      endTick,
      startMs: tickToMs(tempos, mb.start),
      endMs: tickToMs(tempos, endTick),
      numerator,
      denominator,
      section: text || null,
    };
  });
  return { bars, tempos };
}

/** The tempo (quarter notes per minute) in force at a point of the tab. */
export function bpmAtMs(timeline: TabTimeline, ms: number): number | null {
  if (timeline.tempos.length === 0) return null;
  let bpm = timeline.tempos[0].bpm;
  for (const c of timeline.tempos) {
    if (tickToMs(timeline.tempos, c.tick) > ms + 0.5) break;
    bpm = c.bpm;
  }
  return bpm;
}

/** Every distinct tempo the tab plays at, in order of appearance (for the
 *  "96 → 140 bpm" line). */
export function tempoSteps(timeline: TabTimeline): number[] {
  const out: number[] = [];
  for (const c of timeline.tempos) {
    const r = Math.round(c.bpm);
    if (out[out.length - 1] !== r) out.push(r);
  }
  return out;
}

export interface Click {
  /** On whichever clock the beats were asked for: tab ms, or song seconds. */
  at: number;
  /** The first beat of a bar. */
  accent: boolean;
}

/** The metronome's beats on the tab clock in [fromMs, toMs): the time
 *  signature's beat unit (quarters in 4/4, eighths in 6/8), placed through
 *  the tempo map, so the clicks follow every tempo change in the file. The
 *  first beat of a full bar is accented; a pickup bar is not. */
export function tabBeats(timeline: TabTimeline, fromMs: number, toMs: number): Click[] {
  const out: Click[] = [];
  if (!(toMs > fromMs)) return out;
  for (const bar of timeline.bars) {
    if (bar.endMs <= fromMs) continue;
    if (bar.startMs >= toMs) break;
    const step = (TICKS_PER_QUARTER * 4) / bar.denominator;
    const full = bar.endTick - bar.startTick >= bar.numerator * step - 1;
    for (let k = 0; k < bar.numerator; k++) {
      const tick = bar.startTick + k * step;
      if (tick >= bar.endTick - 0.5) break;
      const ms = tickToMs(timeline.tempos, tick);
      if (ms >= fromMs && ms < toMs) out.push({ at: ms, accent: full && k === 0 });
    }
  }
  return out;
}

/** The metronome at a tempo the listener set because the tab's is wrong:
 *  a steady `bpm` on the song clock, counted from where the tab starts in
 *  the song (`startSec`, before it too), accenting every `perBar`. Beats
 *  in [fromSec, toSec), never before the song starts. */
export function steadyBeats(startSec: number, bpm: number, perBar: number, fromSec: number, toSec: number): Click[] {
  const out: Click[] = [];
  if (!(bpm > 0) || !(toSec > fromSec)) return out;
  const period = 60 / bpm;
  const bar = Math.max(1, Math.round(perBar));
  let k = Math.ceil((Math.max(0, fromSec) - startSec) / period - 1e-9);
  for (let guard = 0; guard < 64; guard++, k++) {
    const t = startSec + k * period;
    if (t >= toSec) break;
    if (t < 0 || t < fromSec) continue;
    out.push({ at: t, accent: ((k % bar) + bar) % bar === 0 });
  }
  return out;
}

/** The bar that is playing at a point of the tab (the last one to start
 *  at or before it), or null before the first. */
export function barAtMs(timeline: TabTimeline, ms: number): TimelineBar | null {
  let found: TimelineBar | null = null;
  for (const bar of timeline.bars) {
    if (bar.startMs <= ms + 0.5) found = bar;
    else break;
  }
  return found;
}

/** Each bar's first start on the tab clock by score index, as
 *  lib/tabSync.ts syncPoints wants it. */
export function barStartsOf(timeline: TabTimeline): number[] {
  const out: number[] = [];
  for (const bar of timeline.bars) if (out[bar.index] === undefined) out[bar.index] = bar.startMs;
  return out;
}
