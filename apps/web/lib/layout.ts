// Framework-free layout math shared by shelf-style grids (TrackRow today,
// TrackShelf later). No React import: pure functions so they're trivially
// testable and reusable outside a component's render.

export type ShelfVariant = 'default' | 'lyrics';

interface RowCounts {
  base: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

// One row's visible card count per breakpoint, for each shelf variant.
// `default` is the full-width shelf; `lyrics` is the narrower layout used
// when the desktop LyricsPanel eats ~max(40vw, 28rem) of `main`. These are
// the values TrackRow's GRID_COLS_DEFAULT/GRID_COLS_LYRICS strings and
// useResponsiveRowCount encoded by hand before this module existed; there is
// no md-specific breakpoint for `lyrics` (the original hook only checked
// >=1024 and >=640), so md and xl mirror the neighboring value.
export const SHELF_ROW_COUNT: Record<ShelfVariant, RowCounts> = {
  default: { base: 2, sm: 4, md: 5, lg: 6, xl: 6 },
  lyrics: { base: 2, sm: 3, md: 3, lg: 4, xl: 4 },
};

// Tailwind's default breakpoint thresholds (min-width, px). Kept local
// rather than imported so this file stays framework-free.
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024 } as const;

/** The grid-cols class string TrackRow renders for a variant. Built from
 *  SHELF_ROW_COUNT so the class string and the visible-count math can never
 *  drift apart again. */
export function gridColsClass(variant: ShelfVariant): string {
  const c = SHELF_ROW_COUNT[variant];
  return `grid-cols-${c.base} sm:grid-cols-${c.sm} md:grid-cols-${c.md} lg:grid-cols-${c.lg}`;
}

// Columns by the width the shelf's grid actually gets (bughunt V8), widest
// first. The window width alone lied at tablet sizes: at 768 the sidebar
// leaves ~460px, and 5 columns made 80px cards. Tuned so the phone (342px:
// 2) and the desktop (976px at 1280: 6; 528px with the lyrics panel open:
// 4) keep the counts they always had. `lyrics` tops out at 4, as before.
const SHELF_COLUMNS: Record<ShelfVariant, ReadonlyArray<readonly [minWidth: number, columns: number]>> = {
  default: [[840, 6], [700, 5], [560, 4], [420, 3], [0, 2]],
  lyrics: [[500, 4], [380, 3], [0, 2]],
};

/** How many columns a shelf grid of this width (px) gets. */
export function columnsForWidth(variant: ShelfVariant, width: number): number {
  return SHELF_COLUMNS[variant].find(([min]) => width >= min)![1];
}

/** How many cards fit in one row at a given viewport width, matching the
 *  breakpoint checks TrackRow's useResponsiveRowCount used to do inline.
 *  Now only the guess before the shelf has measured itself (and in tests,
 *  where nothing has a width). */
export function visibleCount(variant: ShelfVariant, width: number): number {
  const c = SHELF_ROW_COUNT[variant];
  if (width >= BREAKPOINTS.lg) return c.lg;
  if (width >= BREAKPOINTS.md) return c.md;
  if (width >= BREAKPOINTS.sm) return c.sm;
  return c.base;
}
