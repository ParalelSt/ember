'use client';

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SpeechStartError, toSpeechErrorKind, type NativeSpeech, type SpeechEvents } from './types';

/** The IPC bridge can be absent or refused on a remote origin (see
 *  permissions/app-commands.toml), in which case invoke() may never settle.
 *  The probe is short so a dead bridge cannot hang the mic. */
const PROBE_TIMEOUT_MS = 2000;
/** speech_start waits for the OS permission dialogs on first use (macOS asks
 *  twice), so it gets far longer than the probe. */
const START_TIMEOUT_MS = 90000;

type WinLike = Window | undefined;

export function tauriSpeechPresent(win: WinLike = globalThis.window): boolean {
  if (!win) return false;
  const internals = (win as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

class Timeout extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Timeout(`${what} timed out`)), ms);
      }),
    ]);
  } finally {
    // Otherwise the pending timer keeps vitest awake after a fast answer.
    clearTimeout(timer);
  }
}

/** Maps an invoke rejection. Rust commands reject with `{ kind, detail }`;
 *  a desktop build from before voice search rejects with Tauri's own string
 *  ("... not found", "... not allowed by ACL"), which means "update the app". */
export function tauriStartError(err: unknown): SpeechStartError {
  if (err instanceof Timeout) return new SpeechStartError('unavailable', err.message, 'no-bridge');
  if (err && typeof err === 'object' && 'kind' in err) {
    const e = err as { kind?: unknown; detail?: unknown };
    return new SpeechStartError(toSpeechErrorKind(e.kind), typeof e.detail === 'string' ? e.detail : undefined);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/not allowed|not found/i.test(msg)) return new SpeechStartError('unavailable', msg, 'no-bridge');
  return new SpeechStartError('unavailable', msg);
}

export function createTauriSpeech(): NativeSpeech {
  let finish: (() => void) | null = null;

  return {
    async start(lang: string, events: SpeechEvents): Promise<void> {
      let ended = false;
      const unlisteners: Array<Promise<UnlistenFn>> = [];
      const end = () => {
        if (ended) return;
        ended = true;
        finish = null;
        events.onEnd();
        for (const u of unlisteners) {
          void u.then((fn) => fn()).catch(() => {});
        }
      };
      finish = end;
      const on = <T>(name: string, cb: (payload: T) => void) => {
        unlisteners.push(
          listen<T>(name, (e) => {
            if (!ended) cb(e.payload);
          }),
        );
      };
      on<{ text?: unknown }>('speech:partial', (d) => events.onPartial(typeof d?.text === 'string' ? d.text : ''));
      on<{ text?: unknown }>('speech:final', (d) => events.onFinal(typeof d?.text === 'string' ? d.text : ''));
      on<{ kind?: unknown; detail?: unknown }>('speech:error', (d) =>
        events.onError(toSpeechErrorKind(d?.kind), typeof d?.detail === 'string' ? d.detail : undefined),
      );
      on('speech:end', end);

      const fail = (err: unknown): never => {
        const e = tauriStartError(err);
        if (!ended) events.onError(e.kind, e.detail);
        end();
        throw e;
      };

      try {
        // Listeners first, so nothing Rust sends right after start is lost.
        // speech_available doubles as the bridge probe; its answer is not a
        // gate, since speech_start names the exact reason (e.g. the Windows
        // speech privacy setting) where available() can only say false.
        await withTimeout(
          Promise.all([...unlisteners, invoke('speech_available')]),
          PROBE_TIMEOUT_MS,
          'speech bridge',
        );
      } catch (err) {
        fail(err);
      }
      try {
        await withTimeout(invoke('speech_start', { lang }), START_TIMEOUT_MS, 'speech_start');
      } catch (err) {
        if (err instanceof Timeout) {
          // Rust may still start later; make sure it does not listen unseen.
          void invoke('speech_abort').catch(() => {});
          fail(new SpeechStartError('unavailable', err.message));
        }
        fail(err);
      }
    },
    stop() {
      void invoke('speech_stop').catch(() => {});
    },
    abort() {
      void invoke('speech_abort').catch(() => {});
      // Rust sends end after a cancel, but a wedged bridge must not keep the
      // listeners alive.
      finish?.();
    },
  };
}
