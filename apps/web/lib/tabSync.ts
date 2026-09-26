/** The arithmetic between Ember's playback and a tab drawn by AlphaTab in
 *  external media mode. Ember owns the
 *  time axis; AlphaTab only draws. Everything here is pure so it can be
 *  unit tested without a score, a browser or a player. */

/** How far a tab may be nudged against the recording, in milliseconds.
 *  Intros, count-ins and silence at the top of a file differ from the
 *  release, and no amount of cleverness can guess by how much. A tab of
 *  one song inside a long live set or a medley can start minutes in, so
 *  the reach is half an hour rather than the old ten seconds. */
export const MAX_OFFSET_MS = 30 * 60 * 1000;

/** The nudge's resolution: fine enough to line up a fast riff by ear. */
export const OFFSET_STEP_MS = 10;

/** MIDI ticks per quarter note in AlphaTab's timeline. */
export const TICKS_PER_QUARTER = 960;

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  const v = Math.round(ms / OFFSET_STEP_MS) * OFFSET_STEP_MS;
  return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, v)) || 0;
}

/** Song time (seconds) to the tab's clock (milliseconds). A positive offset
 *  means the tab runs ahead of the recording. */
export function songToTabMs(songSec: number, offsetMs: number): number {
  return Math.max(0, songSec * 1000 + offsetMs);
}

/** The inverse: where in the song a point of the tab sounds, in seconds. */
export function tabMsToSongSec(tabMs: number, offsetMs: number): number {
  return Math.max(0, (tabMs - offsetMs) / 1000);
}

// ── a tab lined up with the recording ─────────────────────────────────────

/** Where a tab sits in the recording, as align.py found it,
 *  stored on the tab row as `timing`. */
export interface TabTiming {
  /** Where the tab's first bar starts in the song. */
  offsetMs: number;
  /** The recording's tempo, quarter notes per minute. */
  bpm: number;
  /** How sure the alignment is, 0 to 1. */
  confidence: number;
  /** Where each bar starts in the song (bar 0 is the tab's first bar). */
  bars: { bar: number; ms: number }[];
}

/** Under this the tab is "not lined up yet": drawn at the song's start
 *  plus the nudge, as before, with a "Line it up" button. */
export const LINED_UP_CONFIDENCE = 0.5;

export function isLinedUp(timing: TabTiming | null | undefined): timing is TabTiming {
  return !!timing && Number.isFinite(timing.confidence) && timing.confidence >= LINED_UP_CONFIDENCE && Number.isFinite(timing.offsetMs);
}

/** `timing` as the row stores it (snake case, from align.py), or null when
 *  it is missing or malformed. */
export function readTiming(raw: unknown): TabTiming | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const offset = n(t.offset_ms ?? t.offsetMs);
  const confidence = n(t.confidence);
  if (offset === null || confidence === null) return null;
  const bars = (Array.isArray(t.bars) ? t.bars : [])
    .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : null))
    .filter((b): b is Record<string, unknown> => !!b && Number.isInteger(b.bar) && n(b.ms) !== null)
    .map((b) => ({ bar: b.bar as number, ms: b.ms as number }));
  return { offsetMs: offset, bpm: n(t.bpm) ?? 0, confidence, bars };
}

/** A point both clocks agree on: this song time is this tab time (ms). */
export interface SyncPoint {
  song: number;
  tab: number;
}

/** The anchors of a lined-up tab: each bar's start in the song against the
 *  same bar's start on the tab's clock (`barTabMs[bar]`, from AlphaTab's
 *  tick lookup). Only points that move forward on both clocks are kept, so
 *  the mapping is monotonic and has an inverse. With no bar anchors, the
 *  tab's first bar at `offsetMs` is the one point. */
export function syncPoints(timing: TabTiming | null, barTabMs: number[]): SyncPoint[] {
  if (!timing) return [];
  const raw = timing.bars
    .filter((b) => b.bar >= 0 && b.bar < barTabMs.length && Number.isFinite(barTabMs[b.bar]))
    .map((b) => ({ song: b.ms, tab: barTabMs[b.bar] }))
    .sort((a, b) => a.tab - b.tab);
  const out: SyncPoint[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last || (p.song > last.song && p.tab > last.tab)) out.push(p);
  }
  if (out.length === 0) out.push({ song: timing.offsetMs, tab: 0 });
  return out;
}

/** The slope (tab ms per song ms) used past either end of the anchors:
 *  the neighbouring segment's, within sane bounds, else 1. */
function edgeSlope(a: SyncPoint | undefined, b: SyncPoint | undefined): number {
  if (!a || !b || b.song === a.song) return 1;
  const k = (b.tab - a.tab) / (b.song - a.song);
  return Number.isFinite(k) ? Math.max(0.5, Math.min(2, k)) : 1;
}

/** Interpolate `x` from the `from` clock to the `to` clock over sorted
 *  points, linear between them and along the edge slope beyond. */
function piecewise(points: SyncPoint[], x: number, from: 'song' | 'tab', to: 'song' | 'tab'): number {
  const n = points.length;
  if (n === 1) return points[0][to] + (x - points[0][from]);
  if (x <= points[0][from]) {
    const k = edgeSlope(points[0], points[1]);
    const slope = from === 'song' ? k : 1 / k;
    return points[0][to] + (x - points[0][from]) * slope;
  }
  if (x >= points[n - 1][from]) {
    const k = edgeSlope(points[n - 2], points[n - 1]);
    const slope = from === 'song' ? k : 1 / k;
    return points[n - 1][to] + (x - points[n - 1][from]) * slope;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][from] <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}

/** Song time (seconds) to the tab's clock (ms) for a lined-up tab: the
 *  nudge first (a positive nudge runs the tab ahead, as songToTabMs), then
 *  piecewise linear between the bar anchors. No points: the plain path,
 *  exactly songToTabMs. */
export function songSecToTabMs(songSec: number, points: SyncPoint[], nudgeMs: number): number {
  if (points.length === 0) return songToTabMs(songSec, nudgeMs);
  return Math.max(0, piecewise(points, songSec * 1000 + nudgeMs, 'song', 'tab'));
}

/** The inverse: where in the song a point of the tab sounds, in seconds. */
export function tabMsToSongSecAligned(tabMs: number, points: SyncPoint[], nudgeMs: number): number {
  if (points.length === 0) return tabMsToSongSec(tabMs, nudgeMs);
  return Math.max(0, (piecewise(points, tabMs, 'tab', 'song') - nudgeMs) / 1000);
}

/** Each master bar's start on the tab's clock, from AlphaTab's tick lookup
 *  (bars in playing order; a bar played twice keeps its first start). */
export function barStartsMs(masterBars: { start: number; masterBar?: { index?: number }; tempoChanges?: { tick: number; tempo: number }[] }[]): number[] {
  const tempos = tempoMap(masterBars);
  const out: number[] = [];
  masterBars.forEach((mb, i) => {
    const index = typeof mb.masterBar?.index === 'number' ? mb.masterBar.index : i;
    if (out[index] === undefined) out[index] = tickToMs(tempos, mb.start);
  });
  return out;
}

// ── ticks and tempo ───────────────────────────────────────────────────────

export interface TempoChange {
  /** Absolute tick the tempo starts at. */
  tick: number;
  bpm: number;
}

/** The score's tempo map from AlphaTab's tick lookup
 *  (`api.tickCache.masterBars[].tempoChanges`), sorted and deduplicated. */
export function tempoMap(masterBars: { tempoChanges?: { tick: number; tempo: number }[] }[]): TempoChange[] {
  const out: TempoChange[] = [];
  for (const mb of masterBars) {
    for (const c of mb.tempoChanges ?? []) {
      if (c.tempo > 0) out.push({ tick: c.tick, bpm: c.tempo });
    }
  }
  out.sort((a, b) => a.tick - b.tick);
  return out.filter((c, i) => i === 0 || c.tick !== out[i - 1].tick || c.bpm !== out[i - 1].bpm);
}

/** Milliseconds from the top of the score to `tick`, walking the tempo map
 *  the way AlphaTab's sequencer does (120 bpm before the first change). */
export function tickToMs(tempos: TempoChange[], tick: number): number {
  let ms = 0;
  let bpm = 120;
  let from = 0;
  for (const c of tempos) {
    if (c.tick > tick) break;
    // Multiplied out before dividing: whole bars come out as whole ms
    // (the metronome compares beat times against window edges).
    ms += ((c.tick - from) * 60_000) / (bpm * TICKS_PER_QUARTER);
    bpm = c.bpm;
    from = c.tick;
  }
  return ms + ((tick - from) * 60_000) / (bpm * TICKS_PER_QUARTER);
}

/** The pieces of AlphaTab's `MidiTickLookup` a click needs. */
export interface TickLookup {
  masterBars: { tempoChanges?: { tick: number; tempo: number }[] }[];
  getMasterBarStart(masterBar: unknown): number;
  getRelativeBeatPlaybackRange?(beat: unknown): { startTick: number } | undefined;
}

/** The pieces of an AlphaTab `Beat` a click needs. */
export interface ClickedBeat {
  playbackStart: number;
  voice: { bar: { masterBar: unknown } };
}

/** Where in the song a clicked beat sounds, in seconds: the beat's first
 *  tick (as AlphaTab itself would seek to it), through the tempo map, then
 *  back through the alignment's anchors (`points`, none for a tab not
 *  lined up) and the nudge. This is the whole of click-to-seek; nothing
 *  else in AlphaTab is allowed to move the song. */
export function beatToSongSec(lookup: TickLookup, beat: ClickedBeat, offsetMs: number, points: SyncPoint[] = []): number {
  const barStart = lookup.getMasterBarStart(beat.voice.bar.masterBar);
  const within = lookup.getRelativeBeatPlaybackRange?.(beat)?.startTick ?? beat.playbackStart;
  return tabMsToSongSecAligned(tickToMs(tempoMap(lookup.masterBars), barStart + within), points, offsetMs);
}

// ── the playhead between player ticks ─────────────────────────────────────

/** The last playhead value the player reported, and when (performance.now). */
export interface Anchor {
  sec: number;
  at: number;
}

/** How far past the last report the estimate may run: the player reports a
 *  few times a second, so a longer silence means it stalled (buffering),
 *  and the cursor should wait rather than run ahead of the sound. */
const MAX_EXTRAPOLATION_MS = 1000;

/** The song time right now. The player's position arrives a few times a
 *  second; the cursor is fed every 50 ms, so between reports it moves on by
 *  the wall clock while playing, at the playback speed (`rate` 0.5: half a
 *  second of song per second). Paused, it holds still. */
export function estimateSongSec(anchor: Anchor, now: number, playing: boolean, rate = 1): number {
  if (!playing) return anchor.sec;
  const elapsed = Math.max(0, Math.min(now - anchor.at, MAX_EXTRAPOLATION_MS));
  return anchor.sec + (elapsed / 1000) * (rate > 0 ? rate : 1);
}

/** The cursor is fed at most this often. */
export const FEED_INTERVAL_MS = 50;

/** The last position fed to the cursor (tab ms) and when (performance.now). */
export interface Fed {
  ms: number;
  at: number;
}

/** How far off continuous playback a fed position may land and still be
 *  playback: the player's reports wobble around the wall-clock estimate by
 *  a few tens of ms. */
export const JUMP_MS = 250;

/** A feed silent this long during playback (a background tab, where
 *  animation frames stop) left the cursor standing still while the song
 *  ran on, so what comes next is a jump. */
const FEED_GAP_MS = 1000;

/** True when `ms` is not where playback from the last feed would have got
 *  to: a seek (a click on a beat, the player bar, a drag, the sync nudge),
 *  the first feed, or a feed resuming after a gap. AlphaTab animates its
 *  cursor towards whatever it is fed, and only snaps it on a seek, so a
 *  jump has to reach it as one or the line slides over for a beat or two. */
export function isJump(prev: Fed | null, ms: number, now: number, playing: boolean): boolean {
  if (!prev) return true;
  const gap = now - prev.at;
  if (playing && gap > FEED_GAP_MS) return true;
  const expected = prev.ms + (playing ? Math.max(0, gap) : 0);
  return Math.abs(ms - expected) > JUMP_MS;
}

// ── follow-scroll ─────────────────────────────────────────────────────────

export type ScrollMode = 'vertical' | 'horizontal';

/** A rectangle in the scroller's content coordinates (scroll offsets
 *  included), which is what the cursor's bar is measured in. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  scrollTop: number;
  scrollLeft: number;
  width: number;
  height: number;
  /** Height covered at the top by sticky chrome (the toolbar). */
  topInset: number;
}

/** Where to scroll so the playing bar stays in view, or null to stay put.
 *
 *  Vertical (page layout): rows of bars wrap and the page scrolls down.
 *  Nothing moves while the bar sits between the toolbar and two thirds of
 *  the view; once it leaves that band (a new row below, or a seek above),
 *  its row is brought to the upper third, like Songsterr.
 *
 *  Horizontal: one row that scrolls sideways, following the playing beat
 *  (on a phone one bar is most of the width, so following bars would let
 *  the cursor reach the edge). Once the beat leaves the band between a
 *  tenth and three fifths of the view, it is brought back to a third, so
 *  what is coming up is always on screen. `beat` is the beat's box.
 *
 *  `hiddenOnly` (paused): a line anywhere on screen stays put, so a click
 *  on a beat does not move the page under the pointer; only a line off
 *  screen (a refresh, a seek from the player bar) is brought into view. */
export function followScroll(
  mode: ScrollMode,
  bar: Box,
  view: Viewport,
  beat: Box = bar,
  { hiddenOnly = false }: { hiddenOnly?: boolean } = {},
): { top?: number; left?: number } | null {
  if (hiddenOnly && onScreen(mode, bar, view, beat)) return null;
  if (mode === 'horizontal') {
    const target = Math.max(0, Math.round(beat.x - view.width / 3));
    const inBand = beat.x >= view.scrollLeft + view.width * 0.1 && beat.x <= view.scrollLeft + view.width * 0.6;
    if (inBand || Math.abs(target - view.scrollLeft) < 2) return null;
    return { left: target };
  }
  const visibleTop = view.scrollTop + view.topInset;
  const usable = view.height - view.topInset;
  const inBand = bar.y >= visibleTop && bar.y + bar.h <= visibleTop + usable * (2 / 3);
  if (inBand) return null;
  const target = Math.max(0, Math.round(bar.y - view.topInset - usable / 3 + bar.h / 2));
  if (Math.abs(target - view.scrollTop) < 2) return null;
  return { top: target };
}

function onScreen(mode: ScrollMode, bar: Box, view: Viewport, beat: Box): boolean {
  if (mode === 'horizontal') return beat.x >= view.scrollLeft && beat.x + beat.w <= view.scrollLeft + view.width;
  const top = view.scrollTop + view.topInset;
  return bar.y >= top && bar.y + bar.h <= view.scrollTop + view.height;
}

// ── the listener's own nudge ──────────────────────────────────────────────

const offsetKey = (tabId: string) => `ember.tab.offset.${tabId}`;

/** A nudge kept on this device, overriding the tab's shared `offset_ms`.
 *  Null when there is none. Stored in seconds, as the old viewer did, so
 *  nudges made before the tab page carry over. */
export function loadLocalOffsetMs(tabId: string): number | null {
  try {
    const raw = window.localStorage.getItem(offsetKey(tabId));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampOffset(n * 1000) : null;
  } catch {
    // Private windows and blocked site data both throw here.
    return null;
  }
}

export function saveLocalOffsetMs(tabId: string, ms: number | null): void {
  try {
    if (ms === null) window.localStorage.removeItem(offsetKey(tabId));
    else window.localStorage.setItem(offsetKey(tabId), String(clampOffset(ms) / 1000));
  } catch {
    // Not being able to remember the nudge is not worth an error.
  }
}
