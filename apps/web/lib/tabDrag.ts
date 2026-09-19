/** Dragging the tab's playback line (docs/tabs-rebuild.md section 4): the
 *  pieces that can be tested without a browser. A press on the line starts
 *  it; moving past a few pixels turns it into a drag, where a ghost line
 *  snaps to the nearest beat; releasing seeks the song there once. Escape
 *  or a cancelled pointer drops it with no seek, and a press that never
 *  moved is an ordinary click-to-seek. */

/** How far a press may wander and still count as a click, in CSS pixels. */
export const DRAG_THRESHOLD_PX = 5;

export type DragPhase = 'idle' | 'pressing' | 'dragging' | 'released' | 'cancelled';

export interface DragState {
  phase: DragPhase;
  pointerId: number | null;
  /** Where the press started and where the pointer is now (client px). */
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export type DragEvent =
  | { type: 'down'; pointerId: number; x: number; y: number }
  | { type: 'move'; pointerId: number; x: number; y: number }
  | { type: 'up'; pointerId: number }
  | { type: 'cancel' }
  | { type: 'reset' };

export const idleDrag: DragState = { phase: 'idle', pointerId: null, startX: 0, startY: 0, x: 0, y: 0 };

/** True while a pointer is down on the line (pressing or dragging). */
export function isActive(s: DragState): boolean {
  return s.phase === 'pressing' || s.phase === 'dragging';
}

/** The drag as a state machine. `released` after `dragging` means seek to
 *  the drop point; `released` straight from `pressing` means it was a click.
 *  Events from a second pointer (another finger) are ignored. */
export function dragReducer(s: DragState, e: DragEvent): DragState {
  switch (e.type) {
    case 'down':
      if (isActive(s)) return s;
      return { phase: 'pressing', pointerId: e.pointerId, startX: e.x, startY: e.y, x: e.x, y: e.y };
    case 'move': {
      if (!isActive(s) || e.pointerId !== s.pointerId) return s;
      const moved = Math.hypot(e.x - s.startX, e.y - s.startY) > DRAG_THRESHOLD_PX;
      return { ...s, x: e.x, y: e.y, phase: s.phase === 'dragging' || moved ? 'dragging' : 'pressing' };
    }
    case 'up':
      if (!isActive(s) || e.pointerId !== s.pointerId) return s;
      return { ...s, phase: 'released' };
    case 'cancel':
      if (!isActive(s)) return s;
      return { ...s, phase: 'cancelled' };
    case 'reset':
      return idleDrag;
  }
}

// ── snapping to a beat ────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parts of AlphaTab's `BoundsLookup` (1.8.4) a snap reads: staff
 *  systems (rows), their master bars, each staff's bar and its beats. All
 *  in pixels relative to the score's host element. */
export interface SnapLookup {
  staffSystems: {
    realBounds: Rect;
    bars: { visualBounds: Rect; bars: { beats: { onNotesX: number; beat: unknown }[] }[] }[];
  }[];
}

export interface Snap<B = unknown> {
  beat: B;
  /** Where the line is drawn: the beat's x, its bar's top and height. */
  x: number;
  y: number;
  h: number;
}

/** The beat nearest to (x, y), in host pixels: the row under the pointer
 *  (or the nearest row, in the gap between two), then the beat on that row
 *  whose notes sit closest to x. AlphaTab's own getBeatAtPos only answers
 *  inside a row and picks the beat to the left; a dragged line should jump
 *  to whichever beat is nearer, and keep answering between rows. */
export function snapToBeat<B = unknown>(lookup: SnapLookup | null | undefined, x: number, y: number): Snap<B> | null {
  const systems = lookup?.staffSystems ?? [];
  let system = null;
  let bestDy = Infinity;
  for (const s of systems) {
    const r = s.realBounds;
    const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
    if (dy < bestDy) {
      bestDy = dy;
      system = s;
    }
    if (dy === 0) break;
  }
  if (!system) return null;
  let best: Snap<B> | null = null;
  let bestDx = Infinity;
  for (const mb of system.bars) {
    for (const bar of mb.bars.slice(0, 1)) {
      for (const b of bar.beats) {
        const dx = Math.abs(b.onNotesX - x);
        if (dx < bestDx) {
          bestDx = dx;
          best = { beat: b.beat as B, x: b.onNotesX, y: mb.visualBounds.y, h: mb.visualBounds.h };
        }
      }
    }
  }
  return best;
}

// ── scrolling at the edge ─────────────────────────────────────────────────

/** How close to an edge of the visible score the pointer must come to scroll
 *  it, and the fastest it scrolls (px per frame). */
export const EDGE_ZONE_PX = 48;
export const EDGE_MAX_SPEED = 16;

/** Scroll speed for a pointer at `pos` inside the visible span [start, end]:
 *  negative near the start, positive near the end, faster the closer (and
 *  past) the edge, 0 in between. */
export function edgeScrollSpeed(pos: number, start: number, end: number, zone = EDGE_ZONE_PX): number {
  if (end - start <= zone * 2) return 0;
  if (pos < start + zone) return -Math.round(EDGE_MAX_SPEED * Math.min(1, (start + zone - pos) / zone));
  if (pos > end - zone) return Math.round(EDGE_MAX_SPEED * Math.min(1, (pos - (end - zone)) / zone));
  return 0;
}
