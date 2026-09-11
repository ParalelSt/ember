/** The global keyboard map: Space play/pause, M mute, left/right seek by 5s,
 *  up/down volume by 0.05. Pure, so the map and its guards can be tested
 *  without a window; the provider turns an Action into the matching player
 *  call.
 *
 *  preventDefault is the caller's job, and it is NOT called for every key:
 *  only for 'toggle', 'mute' and 'volumeBy', and for 'seekBy' only when an
 *  audio backend exists (a seek with no backend leaves the browser's own
 *  arrow-key scrolling alone, as it always has). 'ignore' and null never
 *  preventDefault. */

/** What a keypress does. 'ignore' means a recognised reason to do nothing (the
 *  user is typing, nothing is loaded, or a held key is repeating); null, which
 *  shortcutFor returns instead of an Action, means the key is simply not
 *  bound. Both end in the same no-op, and the distinction keeps the reason
 *  visible to the caller and to tests. */
export type ShortcutAction =
  | { type: 'toggle' }
  | { type: 'mute' }
  | { type: 'seekBy'; sec: number }
  | { type: 'volumeBy'; delta: number; volume: number }
  | { type: 'ignore' };

/** The parts of a KeyboardEvent the map reads. */
export interface ShortcutEvent {
  key: string;
  code?: string;
  repeat?: boolean;
  target?: TypingTarget | null;
}

/** The parts of an event target that decide whether the user is typing. */
export interface TypingTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export interface ShortcutState {
  /** Whether a track is loaded. With an empty queue every shortcut is a no-op. */
  hasCurrent: boolean;
  /** The current volume, so the volume step can be clamped here. */
  volume: number;
  /** Volume ceiling: party mode raises it to 1, otherwise 0.85. */
  ceiling?: number;
}

export const SEEK_STEP_SEC = 5;
export const VOLUME_STEP = 0.05;
export const DEFAULT_VOLUME_CEILING = 0.85;

/** Typing beats shortcuts: Space in a search box must type a space. */
export function isTypingTarget(el: TypingTarget | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.isContentEditable);
}

export function shortcutFor(event: ShortcutEvent, state: ShortcutState): ShortcutAction | null {
  if (isTypingTarget(event.target)) return { type: 'ignore' };
  if (!state.hasCurrent) return { type: 'ignore' };

  if (event.code === 'Space' || event.key === ' ') {
    // A held Space would machine-gun play/pause; one press, one toggle.
    if (event.repeat) return { type: 'ignore' };
    return { type: 'toggle' };
  }
  if (event.key === 'm' || event.key === 'M') {
    if (event.repeat) return { type: 'ignore' };
    return { type: 'mute' };
  }
  // Held arrows deliberately repeat: holding one scrubs or ramps the volume.
  if (event.key === 'ArrowLeft') return { type: 'seekBy', sec: -SEEK_STEP_SEC };
  if (event.key === 'ArrowRight') return { type: 'seekBy', sec: SEEK_STEP_SEC };
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const delta = event.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP;
    const ceiling = state.ceiling ?? DEFAULT_VOLUME_CEILING;
    return { type: 'volumeBy', delta, volume: Math.max(0, Math.min(ceiling, state.volume + delta)) };
  }
  return null;
}
