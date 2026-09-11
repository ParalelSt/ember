'use client';

import { useEffect, type RefObject } from 'react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { shortcutFor, type TypingTarget } from '@/lib/playback/shortcuts';
import type { AudioBackend } from '@/lib/playback/types';

/** Global keyboard shortcuts. The map itself is pure (lib/playback/shortcuts);
 *  this hook only performs the action it names. preventDefault stays exactly
 *  where it was: on a seek it is called only when a backend exists, so with no
 *  audio the arrow keys still scroll the page.
 *
 *  The transport calls go straight to the backend rather than through the
 *  provider's `toggle`, which is what the provider did: `toggle` also marks the
 *  session as user-interacted and writes a breadcrumb, and a keypress never
 *  did either. */
export function useKeyboardShortcuts({
  backendRef,
}: {
  backendRef: RefObject<AudioBackend | null>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = usePlayerStore.getState();
      const action = shortcutFor(
        { key: e.key, code: e.code, repeat: e.repeat, target: e.target as TypingTarget | null },
        {
          hasCurrent: Boolean(st.queue[st.index]),
          volume: st.volume,
          ceiling: useSettingsStore.getState().partyVolume ? 1 : 0.85,
        },
      );
      if (!action || action.type === 'ignore') return;
      const b = backendRef.current;

      if (action.type === 'toggle') {
        e.preventDefault();
        if (b) {
          if (b.isPaused()) b.play();
          else b.pause();
        }
        return;
      }
      if (action.type === 'mute') {
        e.preventDefault();
        usePlayerStore.getState().toggleMuted();
        return;
      }
      if (action.type === 'seekBy') {
        if (!b) return;
        e.preventDefault();
        b.seek(b.getCurrentTime() + action.sec);
        return;
      }
      // Explicit rather than a fall-through, so a future action type cannot
      // silently take the volume path.
      if (action.type === 'volumeBy') {
        e.preventDefault();
        const state = usePlayerStore.getState();
        if (state.muted) state.setMuted(false);
        state.setVolume(action.volume);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // backendRef is a ref object: stable for the life of the provider, so the
    // listener is still registered exactly once, as it was inline.
  }, [backendRef]);
}
