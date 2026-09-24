import { describe, expect, it } from 'vitest';
import { columnsForWidth, gridColsClass, visibleCount } from './layout';

describe('gridColsClass', () => {
  it('matches the original TrackRow GRID_COLS_DEFAULT string', () => {
    expect(gridColsClass('default')).toBe(
      'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
    );
  });

  it('matches the original TrackRow GRID_COLS_LYRICS string', () => {
    expect(gridColsClass('lyrics')).toBe(
      'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4',
    );
  });
});

describe('visibleCount', () => {
  describe('default variant', () => {
    it('base below sm (640)', () => {
      expect(visibleCount('default', 639)).toBe(2);
    });
    it('sm at and above 640, below md (768)', () => {
      expect(visibleCount('default', 640)).toBe(4);
      expect(visibleCount('default', 767)).toBe(4);
    });
    it('md at and above 768, below lg (1024)', () => {
      expect(visibleCount('default', 768)).toBe(5);
      expect(visibleCount('default', 1023)).toBe(5);
    });
    it('lg at and above 1024', () => {
      expect(visibleCount('default', 1024)).toBe(6);
      expect(visibleCount('default', 1920)).toBe(6);
    });
  });

  describe('lyrics variant', () => {
    it('base below sm (640)', () => {
      expect(visibleCount('lyrics', 639)).toBe(2);
    });
    it('sm/md at and above 640, below lg (1024)', () => {
      expect(visibleCount('lyrics', 640)).toBe(3);
      expect(visibleCount('lyrics', 767)).toBe(3);
      expect(visibleCount('lyrics', 768)).toBe(3);
      expect(visibleCount('lyrics', 1023)).toBe(3);
    });
    it('lg at and above 1024', () => {
      expect(visibleCount('lyrics', 1024)).toBe(4);
      expect(visibleCount('lyrics', 1920)).toBe(4);
    });
  });
});

// Bughunt V8: the shelf's own width decides, not the window's.
describe('columnsForWidth', () => {
  it.each([
    [312, 2], // 360 phone
    [342, 2], // 390 phone
    [382, 2], // 430 phone
    [464, 3], // 768 tablet, beside the sidebar
    [592, 4], // 640, no sidebar
    [720, 5], // 1024
    [976, 6], // 1280
    [1280, 6], // content max
  ])('default: %ipx gets %i columns', (width, cols) => {
    expect(columnsForWidth('default', width)).toBe(cols);
  });

  it.each([
    [150, 2], // 768 with the lyrics panel
    [310, 2], // 1024 with the lyrics panel
    [342, 2], // phone (the panel is desktop only)
    [400, 3],
    [528, 4], // 1280 with the lyrics panel, as before
    [1168, 4], // 1920 with the lyrics panel: never more than 4
  ])('lyrics: %ipx gets %i columns', (width, cols) => {
    expect(columnsForWidth('lyrics', width)).toBe(cols);
  });
});
