import type { NativeSpeech, SpeechAdapter, SpeechEvents } from './types';

type SetTimer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (id: unknown) => void;

export interface SpeechSessionOptions {
  lang: string;
  events: SpeechEvents;
  /** Hard cap on one listen, whatever the recognizer thinks of the silence. */
  hardTimeoutMs?: number;
  /** After the cap's stop(), how long to wait for onEnd before abort(). */
  abortGraceMs?: number;
  setTimeout?: SetTimer;
  clearTimeout?: ClearTimer;
}

export interface SpeechSession {
  start(): Promise<void>;
  stop(): void;
  abort(): void;
}

/** One listen over any adapter, with the guarantees the UI relies on: onEnd
 *  reaches the caller exactly once (even when a bridge never answers), nothing
 *  arrives after it, and our own cancel never shows up as an error. */
export function createSpeechSession(adapter: SpeechAdapter, opts: SpeechSessionOptions): SpeechSession {
  const hardTimeoutMs = opts.hardTimeoutMs ?? 15000;
  const abortGraceMs = opts.abortGraceMs ?? 3000;
  const setTimer: SetTimer = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer: ClearTimer =
    opts.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
  const { events } = opts;

  let native: NativeSpeech | null = null;
  let ended = false;
  let hardTimer: unknown = null;
  let graceTimer: unknown = null;

  const clearTimers = () => {
    if (hardTimer !== null) clearTimer(hardTimer);
    if (graceTimer !== null) clearTimer(graceTimer);
    hardTimer = null;
    graceTimer = null;
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimers();
    events.onEnd();
  };

  const guarded: SpeechEvents = {
    onPartial(text) {
      if (!ended) events.onPartial(text);
    },
    onFinal(text) {
      if (!ended) events.onFinal(text);
    },
    onError(kind, detail) {
      if (ended || kind === 'aborted') return;
      events.onError(kind, detail);
    },
    onEnd: finish,
  };

  const abort = () => {
    if (ended) return;
    native?.abort();
    // A dead bridge may never send end; the UI must not stay "listening".
    finish();
  };

  return {
    async start() {
      if (native || ended) return;
      native = adapter.create();
      hardTimer = setTimer(() => {
        hardTimer = null;
        if (ended) return;
        native?.stop();
        graceTimer = setTimer(() => {
          graceTimer = null;
          abort();
        }, abortGraceMs);
      }, hardTimeoutMs);
      try {
        await native.start(opts.lang, guarded);
      } catch (err) {
        finish();
        throw err;
      }
    },
    stop() {
      if (!ended) native?.stop();
    },
    abort,
  };
}
