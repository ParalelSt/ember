import type { ReactNode } from 'react';

/** The quiet round buttons beside Play (Shuffle, the playlist's ...): a 44px
 *  circle on the soft secondary fill (the owner's "soft circles" pick). The
 *  thin border is transparent until a toggle is on (ACTION_CIRCLE_ON), so
 *  switching never shifts the row. */
export const ACTION_CIRCLE =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-transparent bg-secondary text-foreground transition-colors hover:bg-accent disabled:opacity-50 aria-expanded:bg-accent';

/** A toggle in ACTION_CIRCLE while on: Ember icon and a thin Ember border. */
export const ACTION_CIRCLE_ON = 'border-ember text-ember hover:text-ember';

/** Presentational only: lays out a collection's action buttons (play,
 *  shuffle, download, etc). No outer margin: CollectionHeader places it
 *  `stack` 24 under the meta line and the page puts `stack` 24 under it. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div data-testid="action-bar" className="flex flex-wrap items-center gap-cluster">
      {children}
    </div>
  );
}
