/** The tab page's metronome ("Small Web
 *  Audio click from the score tempo map"). AlphaTab's own metronome only
 *  sounds through its synthesizer, which Ember does not use, so the clicks
 *  are scheduled here against Ember's playhead: a short look ahead every
 *  few tens of ms, each beat handed to Web Audio once at its exact time.
 *
 *  `planClicks` is the pure part (which beats to schedule now, and how far
 *  ahead in real time at the current playback speed); `playClick` makes
 *  the sound on any AudioContext-shaped object, so tests pass a fake. */

import type { Click } from '@/lib/tabTimeline';

/** How far ahead (real seconds) clicks are handed to Web Audio. Longer
 *  than the scheduler's interval, so a late timer never drops a beat. */
export const LOOKAHEAD_SEC = 0.15;

/** How often the scheduler runs (ms). */
export const SCHEDULE_MS = 25;

/** A playhead this far from where it should have got to was moved (a
 *  seek, a loop, the sync nudge): nothing scheduled before counts. */
export const JUMP_SEC = 0.25;

export interface PlannedClick {
  /** Song seconds the beat sounds at. */
  at: number;
  /** Real seconds from now. */
  delay: number;
  accent: boolean;
}

/** Of `beats` (song seconds), the ones to schedule now: after the last one
 *  scheduled, not already past (a beat a few ms late still clicks at
 *  once), each with its delay in real time at `rate` (0.5: half speed, so
 *  a beat 0.1 s of song away is 0.2 s away). Returns them and the new
 *  "last scheduled" mark. */
export function planClicks(beats: Click[], songSec: number, rate: number, last: number): { clicks: PlannedClick[]; last: number } {
  const r = rate > 0 ? rate : 1;
  const clicks: PlannedClick[] = [];
  let mark = last;
  for (const b of [...beats].sort((x, y) => x.at - y.at)) {
    if (b.at <= mark + 1e-6) continue;
    if (b.at < songSec - 0.02) continue;
    clicks.push({ at: b.at, delay: Math.max(0, (b.at - songSec) / r), accent: b.accent });
    mark = b.at;
  }
  return { clicks, last: mark };
}

/** True when the playhead is not where running on from `prev` would have
 *  put it (see JUMP_SEC). */
export function clockJumped(prev: { sec: number; at: number } | null, sec: number, now: number, rate: number): boolean {
  if (!prev) return true;
  const expected = prev.sec + (Math.max(0, now - prev.at) / 1000) * (rate > 0 ? rate : 1);
  return Math.abs(sec - expected) > JUMP_SEC;
}

/** The parts of an AudioContext a click needs. */
export interface ClickAudio {
  currentTime: number;
  destination: unknown;
  createOscillator(): {
    frequency: { value: number };
    type: string;
    connect(node: unknown): unknown;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown };
    connect(node: unknown): unknown;
  };
}

/** One click at `when` (context seconds): a short high blip, higher and
 *  louder on the first beat of a bar. */
export function playClick(ctx: ClickAudio, when: number, accent: boolean, volume = 0.6): void {
  const t = Math.max(when, ctx.currentTime);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1760 : 1320;
  const peak = Math.max(0.0001, Math.min(1, volume * (accent ? 1 : 0.6)));
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.05);
}

let shared: AudioContext | null = null;

/** The page's one AudioContext for clicks, made (or woken) on the gesture
 *  that turns the metronome on, as browsers require. Null where there is
 *  no Web Audio. */
export function clickContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!shared || shared.state === 'closed') shared = new Ctor();
    if (shared.state === 'suspended') void shared.resume().catch(() => {});
    return shared;
  } catch {
    return null;
  }
}
