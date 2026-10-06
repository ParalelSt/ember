/** The tab page's stage (the owner's pick): the tab fills the screen under
 *  one thin title line, and a floating pill holds play, where you are,
 *  speed and loop. The pure bits it reads, kept out of the components so
 *  they can be tested on their own. */

import type { ScoreInfo } from '@/lib/tabScore';
import { barAtMs, type TabTimeline } from '@/lib/tabTimeline';
import { barCount, SPEED_PRESETS } from '@/lib/tabPractice';

/** The second line of the title: "Coastline · Rhythm guitar · 75%". The
 *  speed is always said, so 100% tells the song plays as recorded. */
export function stageMeta(artist: string, info: ScoreInfo | null, track: number, rate: number): string {
  const t = info?.tracks[track];
  return [artist, t ? t.name || t.instrument : '', `${Math.round(rate * 100)}%`].filter(Boolean).join(' · ');
}

/** The pill's speed button: each tap one preset slower, and from the
 *  slowest back to full speed. A speed between presets goes to the next
 *  preset under it. */
export function nextSlower(percent: number): number {
  const lower = [...SPEED_PRESETS].reverse().find((p) => p < Math.round(percent));
  return lower ?? 100;
}

/** Where the song is on the tab: the bar playing (1-based, as the tab
 *  numbers it) and how many bars there are. Before the first bar it is bar
 *  1; null while the tab's bars are not known. */
export function barPosition(timeline: TabTimeline | null, tabMs: number): { bar: number; total: number } | null {
  if (!timeline) return null;
  const total = barCount(timeline);
  if (total === 0) return null;
  const bar = barAtMs(timeline, tabMs);
  return { bar: (bar?.index ?? 0) + 1, total };
}

// ── practice toolbar (the owner's pick): five cells with their values ────

export type ToolId = 'speed' | 'loop' | 'click' | 'count' | 'delay';

export interface ToolCell {
  id: ToolId;
  name: string;
  /** What the cell shows under (phone) or after (desktop) its name. */
  value: string;
  /** The setting is doing something: drawn in ember. */
  on: boolean;
}

export interface ToolState {
  speedPercent: number;
  loopOn: boolean;
  /** "Bars 3–6" once a loop is chosen. */
  loopLabel: string | null;
  metronomeOn: boolean;
  /** The click's tempo: the listener's, else the tab's where the song is. */
  bpm: number | null;
  countIn: CountInBars;
  offsetMs: number;
  /** The nudge as the Delay control writes it ("+0.25 s", "-2 beats"). */
  offsetText: string;
}

/** Speed, Loop, Click, Count-in and Delay, each with its value now. */
export function toolCells(s: ToolState): ToolCell[] {
  return [
    { id: 'speed', name: 'Speed', value: `${s.speedPercent}%`, on: s.speedPercent !== 100 },
    { id: 'loop', name: 'Loop', value: s.loopOn && s.loopLabel ? s.loopLabel : 'Off', on: s.loopOn },
    { id: 'click', name: 'Click', value: s.metronomeOn ? (s.bpm ? String(Math.round(s.bpm)) : 'On') : 'Off', on: s.metronomeOn },
    { id: 'count', name: 'Count-in', value: s.countIn ? `${s.countIn} bar${s.countIn === 1 ? '' : 's'}` : 'Off', on: s.countIn > 0 },
    { id: 'delay', name: 'Delay', value: s.offsetText, on: s.offsetMs !== 0 },
  ];
}

// ── count-in ──────────────────────────────────────────────────────────────

/** Bars of clicks before the song starts from the pill's Play. */
export type CountInBars = 0 | 1 | 2;
export const COUNT_IN_CHOICES: readonly CountInBars[] = [0, 1, 2];

/** A stored choice; nothing stored (or anything else) is one bar. */
export function countInFrom(value: unknown): CountInBars {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 ? n : 1;
}

export interface CountInPlan {
  /** Seconds from the start of the count, first beat of each bar accented. */
  clicks: { atSec: number; accent: boolean }[];
  /** When the song starts: one beat after the last click. */
  totalSec: number;
  beatsPerBar: number;
}

/** The count-in's clicks at the tempo the song will be heard at: the tab's
 *  (or the listener's) beats per minute in quarter notes, its time
 *  signature where the song is, slowed with the song. */
export function countInPlan(
  bars: CountInBars,
  { bpm, numerator = 4, denominator = 4, rate = 1 }: { bpm: number | null; numerator?: number; denominator?: number; rate?: number },
): CountInPlan {
  const perBar = numerator > 0 && numerator <= 32 ? Math.round(numerator) : 4;
  if (!bars || !bpm || !(bpm > 0) || !(rate > 0)) return { clicks: [], totalSec: 0, beatsPerBar: perBar };
  const beatSec = ((60 / bpm) * (4 / (denominator > 0 ? denominator : 4))) / rate;
  const clicks = Array.from({ length: bars * perBar }, (_, i) => ({ atSec: i * beatSec, accent: i % perBar === 0 }));
  return { clicks, totalSec: clicks.length * beatSec, beatsPerBar: perBar };
}
