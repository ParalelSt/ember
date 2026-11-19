/** A temporary design preview: four ways to move through the desktop Home
 *  rows, for the owner to pick one from. `?homerows=a|b|c|d` picks one and
 *  remembers it (localStorage); `?homerows=today` goes back to the shipped
 *  rows. Nothing picked = today's rows (the "homedesk2" pick: sideways
 *  scroll by trackpad, Shift+wheel or drag, edge fades, no arrows).
 *
 *    a  header arrows: < > at the right end of each row's title line
 *    b  hover edge arrows: round arrows over the row's edge fades
 *    c  no sideways scroll: one line of whole cards and "Show all"
 *    d  expand in place: one line of whole cards and "Show more"
 */
export type HomeRowsVariant = 'today' | 'a' | 'b' | 'c' | 'd';

export const HOME_ROWS_PARAM = 'homerows';
export const HOME_ROWS_STORAGE_KEY = 'ember.design.homerows';

const VARIANTS: readonly HomeRowsVariant[] = ['today', 'a', 'b', 'c', 'd'];

export function parseHomeRowsVariant(value: string | null | undefined): HomeRowsVariant | null {
  const v = value?.trim().toLowerCase();
  return v && (VARIANTS as readonly string[]).includes(v) ? (v as HomeRowsVariant) : null;
}

/** The URL param wins, then what was saved, then today's rows. */
export function pickHomeRowsVariant(param: string | null | undefined, saved: string | null | undefined): HomeRowsVariant {
  return parseHomeRowsVariant(param) ?? parseHomeRowsVariant(saved) ?? 'today';
}

/** One card's place inside its row, in the row's scroll coordinates. */
export interface RowItemBox {
  left: number;
  width: number;
}

/** Where one press of a row arrow lands: a screen of whole cards on, with a
 *  card's left edge at the row's left edge (never half a card there).
 *  Forward, the first card not wholly in view becomes the first one. Back,
 *  the card just before the first one in view becomes the last whole card,
 *  so nothing is skipped either way. Clamped to the row's ends. */
export function pageTarget(items: readonly RowItemBox[], scrollLeft: number, clientWidth: number, scrollWidth: number, dir: -1 | 1): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (items.length === 0) return Math.min(max, Math.max(0, scrollLeft + dir * clientWidth));
  const view = scrollLeft + clientWidth;
  if (dir > 0) {
    const next = items.find((it) => it.left + it.width > view + 1);
    return next ? Math.min(max, next.left) : max;
  }
  // The first card whose left edge is in view (a card cut at the left counts
  // as hidden, so it is the one that comes back into view first).
  const firstIdx = items.findIndex((it) => it.left >= scrollLeft - 1);
  const before = firstIdx === -1 ? items[items.length - 1] : items[firstIdx - 1];
  if (!before) return 0;
  const want = before.left + before.width - clientWidth;
  const start = items.find((it) => it.left >= want - 1);
  return Math.max(0, Math.min(start ? start.left : 0, scrollLeft));
}

/** How many whole cards of at least `minTile` px fit in one line `width`
 *  wide with `gap` between them (the same count CSS auto-fill gives), at
 *  least one. 0 while the width is not known yet. */
export function fitCount(width: number, minTile: number, gap: number): number {
  if (!(width > 0)) return 0;
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

/** C's full grid of one row: Home with `?row=<key>` (and the variant, so
 *  the link works even where the saved pick cannot be read). */
export function homeRowHref(key: string): string {
  return `/?${HOME_ROWS_PARAM}=c&row=${encodeURIComponent(key)}`;
}
