import type { ReactNode } from 'react';

/** Presentational only: lays out a collection's action buttons (play,
 *  shuffle, download, etc). */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 mb-6">{children}</div>;
}
