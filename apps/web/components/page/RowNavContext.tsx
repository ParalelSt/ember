'use client';

import { createContext, useContext } from 'react';
import type { HomeRowsVariant } from '@/lib/homeRows';

export interface RowNav {
  /** How the desktop rows are moved through (lib/homeRows.ts). */
  variant: HomeRowsVariant;
  /** C's "Show all" page: the row is drawn as a full grid of every tile,
   *  under a back button and its title. */
  fullRow?: boolean;
}

const RowNavContext = createContext<RowNav>({ variant: 'today' });

/** The desktop Home sets this around its rows for the design preview; every
 *  other desktop row (and every phone row) keeps today's look. */
export const RowNavProvider = RowNavContext.Provider;

export function useRowNav(): RowNav {
  return useContext(RowNavContext);
}
