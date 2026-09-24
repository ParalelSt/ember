'use client';

/** A second audio element for prank sounds, beside (never instead of) the
 *  music. Works wherever the music plays through a webview or page: plain
 *  web, the older Android app, and the desktop app next to its Rust engine.
 *  Silent by design: nothing here logs, toasts or throws. */

export type OverlayEnd = 'ended' | 'stopped' | 'cap' | 'error';

export interface OverlayResult {
  reason: OverlayEnd;
  /** How long it was actually heard, capped at maxSec. */
  playedSec: number;
}

export interface OverlayHandle {
  /** True once sound is coming out, false if it never did. */
  started: Promise<boolean>;
  /** Always settles, whatever happens. */
  finished: Promise<OverlayResult>;
}

export interface OverlayPlayer {
  play(url: string, opts: { volume: number; maxSec: number; startTimeoutMs?: number }): OverlayHandle;
  setVolume(v: number): void;
  stop(): void;
  busy(): boolean;
  destroy(): void;
}

/** A sound that has not started within this long is given up on. */
export const OVERLAY_START_TIMEOUT_MS = 8_000;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Invisible and out of the accessibility tree, like the music element. In
 *  the document so the engines treat it as ordinary page media. */
function domAudio(): HTMLAudioElement {
  const a = new Audio();
  a.preload = 'auto';
  a.setAttribute('aria-hidden', 'true');
  a.style.position = 'fixed';
  a.style.width = '1px';
  a.style.height = '1px';
  a.style.opacity = '0';
  a.style.pointerEvents = 'none';
  if (typeof document !== 'undefined') document.body.appendChild(a);
  return a;
}

export function createOverlayPlayer(makeAudio: () => HTMLAudioElement = domAudio): OverlayPlayer {
  let el: HTMLAudioElement | null = null;
  /** Ends whatever is playing now; null when idle. */
  let finish: ((reason: OverlayEnd) => void) | null = null;

  return {
    play(url, { volume, maxSec, startTimeoutMs = OVERLAY_START_TIMEOUT_MS }) {
      finish?.('stopped');
      const a = (el ??= makeAudio());

      let resolveStarted!: (v: boolean) => void;
      let resolveFinished!: (r: OverlayResult) => void;
      const started = new Promise<boolean>((r) => (resolveStarted = r));
      const finished = new Promise<OverlayResult>((r) => (resolveFinished = r));

      let isStarted = false;
      let over = false;
      let capTimer: ReturnType<typeof setTimeout> | undefined;
      const startTimer = setTimeout(() => done('error'), startTimeoutMs);

      const onPlaying = () => {
        if (isStarted || over) return;
        isStarted = true;
        clearTimeout(startTimer);
        // The cap runs from the first sound, whatever the file's length.
        capTimer = setTimeout(() => done('cap'), maxSec * 1000);
        resolveStarted(true);
      };
      const onEnded = () => done('ended');
      const onError = () => done('error');

      function done(reason: OverlayEnd) {
        if (over) return;
        over = true;
        if (finish === done) finish = null;
        clearTimeout(startTimer);
        clearTimeout(capTimer);
        a.removeEventListener('playing', onPlaying);
        a.removeEventListener('ended', onEnded);
        a.removeEventListener('error', onError);
        const playedSec = isStarted ? Math.min(maxSec, Math.max(0, a.currentTime || 0)) : 0;
        try {
          a.pause();
          a.removeAttribute('src');
          a.load();
        } catch {
          // A detached or half-torn-down element: nothing left to release.
        }
        if (!isStarted) resolveStarted(false);
        resolveFinished({ reason, playedSec: Math.round(playedSec * 10) / 10 });
      }
      finish = done;

      a.addEventListener('playing', onPlaying);
      a.addEventListener('ended', onEnded);
      a.addEventListener('error', onError);
      a.volume = clamp01(volume);
      a.src = url;
      try {
        const p = a.play();
        if (p && typeof p.then === 'function') p.then(onPlaying, () => done('error'));
      } catch {
        done('error');
      }
      return { started, finished };
    },

    setVolume(v) {
      if (el && finish) el.volume = clamp01(v);
    },

    stop() {
      finish?.('stopped');
    },

    busy() {
      return finish !== null;
    },

    destroy() {
      finish?.('stopped');
      el?.remove();
      el = null;
    },
  };
}
