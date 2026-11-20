'use client';

import { createContext, useContext } from 'react';

export interface RowNav {
  /** Home's rows: whole cards only (two on a phone, as many as fit on
   *  desktop) with "Show all" for the rest. Rows elsewhere keep the
   *  sideways scroller. */
  fit?: boolean;
  /** The "Show all" page: the row is drawn as a full grid of every tile,
   *  under a back button and its title. */
  fullRow?: boolean;
}

const RowNavContext = createContext<RowNav>({});

/** Home sets this around its rows; every other row keeps its scroller. */
export const RowNavProvider = RowNavContext.Provider;

export function useRowNav(): RowNav {
  return useContext(RowNavContext);
}
