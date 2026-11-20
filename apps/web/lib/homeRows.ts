/** How many whole cards of at least `minTile` px fit in one line `width`
 *  wide with `gap` between them (the same count CSS auto-fill gives), at
 *  least one. 0 while the width is not known yet. */
export function fitCount(width: number, minTile: number, gap: number): number {
  if (!(width > 0)) return 0;
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

/** The full grid of one row: Home with `?row=<key>`. */
export function homeRowHref(key: string): string {
  return `/?row=${encodeURIComponent(key)}`;
}
