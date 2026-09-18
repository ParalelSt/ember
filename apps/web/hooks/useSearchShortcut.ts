'use client';

import { useEffect } from 'react';
import { isTypingTarget, type TypingTarget } from '@/lib/playback/shortcuts';

/** "/" opens the search overlay, ignored while focus is already in an input,
 *  textarea, select or contentEditable — the same guard the player's own
 *  shortcuts use (lib/playback/shortcuts.ts), so the two never fight over a
 *  key: Space/M/arrows only fire once `isTypingTarget` is false, and this
 *  does the same for "/". */
export function useSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      if (isTypingTarget(e.target as TypingTarget | null)) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}
