import type { ReactNode } from 'react';

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
