/** The arithmetic between Ember's playback and a tab drawn by AlphaTab in
 *  external media mode (docs/tabs-rebuild.md section 4). Ember owns the
 *  time axis; AlphaTab only draws. Everything here is pure so it can be
 *  unit tested without a score, a browser or a player. */

/** How far a tab may be nudged against the recording, in milliseconds.
 *  Intros, count-ins and silence at the top of a file differ from the
 *  release, and no amount of cleverness can guess by how much. */
export const MAX_OFFSET_MS = 10_000;

/** MIDI ticks per quarter note in AlphaTab's timeline. */
export const TICKS_PER_QUARTER = 960;

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(ms / 100) * 100));
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
    ms += (c.tick - from) * (60_000 / (bpm * TICKS_PER_QUARTER));
    bpm = c.bpm;
    from = c.tick;
  }
  return ms + (tick - from) * (60_000 / (bpm * TICKS_PER_QUARTER));
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
 *  tick (as AlphaTab itself would seek to it), through the tempo map, minus
 *  the tab's offset. This is the whole of click-to-seek; nothing else in
 *  AlphaTab is allowed to move the song. */
export function beatToSongSec(lookup: TickLookup, beat: ClickedBeat, offsetMs: number): number {
  const barStart = lookup.getMasterBarStart(beat.voice.bar.masterBar);
  const within = lookup.getRelativeBeatPlaybackRange?.(beat)?.startTick ?? beat.playbackStart;
  return tabMsToSongSec(tickToMs(tempoMap(lookup.masterBars), barStart + within), offsetMs);
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
 *  the wall clock while playing. Paused, it holds still. */
export function estimateSongSec(anchor: Anchor, now: number, playing: boolean): number {
  if (!playing) return anchor.sec;
  const elapsed = Math.max(0, Math.min(now - anchor.at, MAX_EXTRAPOLATION_MS));
  return anchor.sec + elapsed / 1000;
}

/** The cursor is fed at most this often (docs/tabs-rebuild.md section 4). */
export const FEED_INTERVAL_MS = 50;

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
 *  Horizontal: one row that scrolls sideways. The bar is kept a third of
 *  the way in, so what is coming up is always on screen. */
export function followScroll(mode: ScrollMode, bar: Box, view: Viewport): { top?: number; left?: number } | null {
  if (mode === 'horizontal') {
    const target = Math.max(0, Math.round(bar.x - view.width / 3));
    const inBand = bar.x >= view.scrollLeft + view.width * 0.1 && bar.x + bar.w <= view.scrollLeft + view.width * 0.8;
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
