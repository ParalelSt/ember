'use client';

import { createContext, useContext } from 'react';

export interface RowNav {
  /** Whole cards only (two on a phone, as many as fit on desktop)
   *  with "Show all" for the rest. Home, the artist page and Radio set it. */
  fit?: boolean;
  /** The "Show all" page: the row is drawn as a full grid of every tile,
   *  under a back button and its title. */
  fullRow?: boolean;
  /** Where Back goes on the "Show all" page (default Home, `/`). */
  backHref?: string;
}

const RowNavContext = createContext<RowNav>({});

/** Home sets this around its rows; every other row keeps its scroller. */
export const RowNavProvider = RowNavContext.Provider;

export function useRowNav(): RowNav {
  return useContext(RowNavContext);
}
