/** A temporary design preview: three ways to keep Home's quick grid to one
 *  row and put the rest behind a menu of all collections, for the owner to
 *  pick one from. `?quickgrid=a|b|c` picks one and remembers it
 *  (localStorage); `?quickgrid=today` goes back to the shipped grid.
 *  Nothing picked = today's grid.
 *
 *    a  one row, then an "All collections (N)" pill under it
 *    b  one row whose last slot is a square "more" button
 *    c  a "Your collections" header line with "See all" on its right
 */
export type QuickGridVariant = 'today' | 'a' | 'b' | 'c';

export const QUICK_GRID_PARAM = 'quickgrid';
export const QUICK_GRID_STORAGE_KEY = 'ember.design.quickgrid';

const VARIANTS: readonly QuickGridVariant[] = ['today', 'a', 'b', 'c'];

export function parseQuickGridVariant(value: string | null | undefined): QuickGridVariant | null {
  const v = value?.trim().toLowerCase();
  return v && (VARIANTS as readonly string[]).includes(v) ? (v as QuickGridVariant) : null;
}

/** The URL param wins, then what was saved, then today's grid. */
export function pickQuickGridVariant(param: string | null | undefined, saved: string | null | undefined): QuickGridVariant {
  return parseQuickGridVariant(param) ?? parseQuickGridVariant(saved) ?? 'today';
}

/** How many tiles show in the one row, and whether the rest sit behind a
 *  menu. `fit` is how many tiles fit the width (2 on a phone). Variant b
 *  gives its last slot to the square button, so it shows one tile fewer
 *  than fit; the menu appears only when not everything fits. */
export function quickGridSlots(total: number, fit: number, variant: 'a' | 'b' | 'c'): { visible: number; overflow: boolean } {
  if (total <= fit) return { visible: total, overflow: false };
  return { visible: variant === 'b' ? Math.max(1, fit - 1) : fit, overflow: true };
}
