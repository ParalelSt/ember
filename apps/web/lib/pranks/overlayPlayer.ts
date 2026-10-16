'use client';

/** A second audio element for prank sounds, beside (never instead of) the
 *  music. Works wherever the music plays through a webview or page: plain
 *  web, the older Android app, and the desktop app next to its Rust engine.
 *  Silent by design: nothing here logs, toasts or throws. */

export type OverlayEnd = 'ended' | 'stopped' | 'cap' | 'error' | 'blocked';

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
  /** Primes the element with a silent clip. Call it synchronously inside a
   *  tap or key handler: mobile browsers only let an element play later,
   *  with no tap of its own, once it has played inside one (iOS asks per
   *  element). Optional so test doubles and older callers need not have it. */
  unlock?(): void;
  play(url: string, opts: { volume: number; maxSec: number; startTimeoutMs?: number }): OverlayHandle;
  setVolume(v: number): void;
  stop(): void;
  busy(): boolean;
  destroy(): void;
}

/** A sound that has not started within this long is given up on. */
export const OVERLAY_START_TIMEOUT_MS = 8_000;

/** A 10 ms silent WAV. Played unmuted: a muted play does not count as the
 *  element having played. */
const SILENCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

/** NotAllowedError is the browser wanting a tap first; anything else is a
 *  failed load. */
const refusal = (e: unknown): OverlayEnd => ((e as { name?: string } | null)?.name === 'NotAllowedError' ? 'blocked' : 'error');

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

  let unlocked = false;
  let priming = false;

  return {
    unlock() {
      if (unlocked || priming || finish) return;
      const a = (el ??= makeAudio());
      a.src = SILENCE;
      priming = true;
      try {
        // play() must be called before anything is awaited: the tap's
        // permission lasts only for this synchronous run.
        Promise.resolve(a.play()).then(() => {
          if (el === a) unlocked = true;
        }, () => {}).finally(() => { priming = false; });
      } catch {
        priming = false;
      }
    },
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
        if (p && typeof p.then === 'function') p.then(onPlaying, (e: unknown) => done(refusal(e)));
      } catch (e) {
        done(refusal(e));
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
      unlocked = false;
    },
  };
}
