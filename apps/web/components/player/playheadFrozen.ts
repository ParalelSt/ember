'use client';

import { createContext } from 'react';

/** True inside a view that is mounted but not on screen (the full-screen
 *  player while closed): usePlayerPosition there holds its last value
 *  instead of re-rendering with every playhead report, and follows again
 *  the moment the view opens. */
export const PlayheadFrozenContext = createContext(false);
