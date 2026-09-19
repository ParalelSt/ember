import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  dragReducer,
  EDGE_MAX_SPEED,
  edgeScrollSpeed,
  idleDrag,
  isActive,
  snapToBeat,
  type DragEvent,
  type DragState,
  type SnapLookup,
} from './tabDrag';

const run = (events: DragEvent[], from: DragState = idleDrag) => events.reduce(dragReducer, from);

describe('dragReducer', () => {
  it('idle -> pressing on a press, nothing else starts it', () => {
    expect(run([{ type: 'move', pointerId: 1, x: 50, y: 50 }]).phase).toBe('idle');
    expect(run([{ type: 'up', pointerId: 1 }]).phase).toBe('idle');
    expect(run([{ type: 'cancel' }]).phase).toBe('idle');
    const s = run([{ type: 'down', pointerId: 1, x: 10, y: 20 }]);
    expect(s).toMatchObject({ phase: 'pressing', pointerId: 1, startX: 10, startY: 20 });
    expect(isActive(s)).toBe(true);
  });

  it('a wobble inside the threshold stays a press, and releasing it is a click', () => {
    const s = run([
      { type: 'down', pointerId: 1, x: 10, y: 20 },
      { type: 'move', pointerId: 1, x: 10 + DRAG_THRESHOLD_PX - 1, y: 21 },
    ]);
    expect(s.phase).toBe('pressing');
    const up = dragReducer(s, { type: 'up', pointerId: 1 });
    expect(up.phase).toBe('released');
    expect(isActive(up)).toBe(false);
  });

  it('moving past the threshold starts a drag, which stays a drag even back at the start', () => {
    const s = run([
      { type: 'down', pointerId: 1, x: 10, y: 20 },
      { type: 'move', pointerId: 1, x: 10 + DRAG_THRESHOLD_PX + 1, y: 20 },
    ]);
    expect(s).toMatchObject({ phase: 'dragging', x: 10 + DRAG_THRESHOLD_PX + 1 });
    expect(dragReducer(s, { type: 'move', pointerId: 1, x: 10, y: 20 }).phase).toBe('dragging');
    expect(dragReducer(s, { type: 'up', pointerId: 1 }).phase).toBe('released');
  });

  it('a vertical move counts too (dragging down to the next row)', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, x: 10, y: 20 },
        { type: 'move', pointerId: 1, x: 10, y: 40 },
      ]).phase,
    ).toBe('dragging');
  });

  it('cancel (Escape, pointercancel) ends a press or a drag as cancelled', () => {
    const pressing = run([{ type: 'down', pointerId: 1, x: 0, y: 0 }]);
    expect(dragReducer(pressing, { type: 'cancel' }).phase).toBe('cancelled');
    const dragging = dragReducer(pressing, { type: 'move', pointerId: 1, x: 40, y: 0 });
    expect(dragReducer(dragging, { type: 'cancel' }).phase).toBe('cancelled');
    expect(dragReducer(dragReducer(dragging, { type: 'cancel' }), { type: 'reset' })).toEqual(idleDrag);
  });

  it('a second finger neither moves, ends nor restarts the drag', () => {
    const s = run([
      { type: 'down', pointerId: 1, x: 0, y: 0 },
      { type: 'down', pointerId: 2, x: 99, y: 99 },
      { type: 'move', pointerId: 2, x: 200, y: 200 },
      { type: 'up', pointerId: 2 },
    ]);
    expect(s).toMatchObject({ phase: 'pressing', pointerId: 1, x: 0, y: 0 });
  });
});

describe('snapToBeat', () => {
  const beat = (id: string, onNotesX: number) => ({ onNotesX, beat: id });
  const lookup: SnapLookup = {
    staffSystems: [
      {
        realBounds: { x: 0, y: 0, w: 400, h: 100 },
        bars: [
          { visualBounds: { x: 0, y: 10, w: 200, h: 80 }, bars: [{ beats: [beat('a', 20), beat('b', 100)] }] },
          { visualBounds: { x: 200, y: 10, w: 200, h: 80 }, bars: [{ beats: [beat('c', 220), beat('d', 300)] }] },
        ],
      },
      {
        realBounds: { x: 0, y: 140, w: 400, h: 100 },
        bars: [
          { visualBounds: { x: 0, y: 150, w: 200, h: 80 }, bars: [{ beats: [beat('e', 20), beat('f', 100)] }] },
          { visualBounds: { x: 200, y: 150, w: 200, h: 80 }, bars: [{ beats: [beat('g', 220), beat('h', 300)] }] },
        ],
      },
    ],
  };

  it('picks the nearest beat on the row under the pointer, either side', () => {
    expect(snapToBeat(lookup, 55, 50)?.beat).toBe('a');
    expect(snapToBeat(lookup, 65, 50)?.beat).toBe('b');
    expect(snapToBeat(lookup, 170, 50)?.beat).toBe('c'); // across a barline
  });

  it('answers on the next row, with that bar’s line box', () => {
    expect(snapToBeat(lookup, 290, 200)).toEqual({ beat: 'h', x: 300, y: 150, h: 80 });
  });

  it('between rows and past the ends it takes the nearest row', () => {
    expect(snapToBeat(lookup, 20, 110)?.beat).toBe('a');
    expect(snapToBeat(lookup, 20, 135)?.beat).toBe('e');
    expect(snapToBeat(lookup, 999, 999)?.beat).toBe('h');
    expect(snapToBeat(lookup, -50, -50)?.beat).toBe('a');
  });

  it('nothing laid out yet: no snap', () => {
    expect(snapToBeat(null, 0, 0)).toBeNull();
    expect(snapToBeat({ staffSystems: [] }, 0, 0)).toBeNull();
  });
});

describe('edgeScrollSpeed', () => {
  it('still in the middle, scrolling back near the start and on near the end', () => {
    expect(edgeScrollSpeed(300, 100, 700)).toBe(0);
    expect(edgeScrollSpeed(110, 100, 700)).toBeLessThan(0);
    expect(edgeScrollSpeed(690, 100, 700)).toBeGreaterThan(0);
  });

  it('faster the closer, capped past the edge', () => {
    expect(Math.abs(edgeScrollSpeed(105, 100, 700))).toBeGreaterThan(Math.abs(edgeScrollSpeed(140, 100, 700)));
    expect(edgeScrollSpeed(900, 100, 700)).toBe(EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(-50, 100, 700)).toBe(-EDGE_MAX_SPEED);
  });

  it('a view too small to have a middle does not scroll', () => {
    expect(edgeScrollSpeed(10, 0, 80)).toBe(0);
  });
});
