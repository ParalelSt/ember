import {
  SpeechStartError,
  isSpeechErrorKind,
  toSpeechErrorKind,
  type NativeSpeech,
  type SpeechEvents,
} from './types';

/** JS surface of the EmberSpeech Capacitor plugin (apps/mobile, Kotlin).
 *  Reached through the bridge Capacitor injects, never imported from npm:
 *  this web app is served by the host, so no plugin JS is ever bundled. */
interface ListenerHandle {
  remove(): unknown;
}
interface EmberSpeechPlugin {
  addListener(event: string, cb: (data: never) => void): Promise<ListenerHandle> | ListenerHandle;
  available(): Promise<{ available: boolean; onDevice: boolean }>;
  start(o: { lang: string }): Promise<void>;
  stop(): Promise<void>;
  abort(): Promise<void>;
}

type WinLike = Window | undefined;

function plugin(win: WinLike): EmberSpeechPlugin | null {
  if (!win) return null;
  const cap = (win as unknown as { Capacitor?: { Plugins?: { EmberSpeech?: EmberSpeechPlugin } } }).Capacitor;
  return cap?.Plugins?.EmberSpeech ?? null;
}

export function capacitorSpeechPresent(win: WinLike = globalThis.window): boolean {
  return plugin(win) !== null;
}

/** A missing or broken bridge must never throw into the search box. */
function quiet(p: unknown): void {
  if (p && typeof (p as Promise<void>).catch === 'function') void (p as Promise<void>).catch(() => {});
}

/** Maps a plugin rejection. Kotlin puts the SpeechErrorKind in `code`;
 *  Capacitor's own UNIMPLEMENTED means an APK without the plugin method. */
function startError(err: unknown): SpeechStartError {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const detail = typeof e.message === 'string' ? e.message : undefined;
  if (e.code === 'UNIMPLEMENTED') return new SpeechStartError('unavailable', detail, 'no-bridge');
  return new SpeechStartError(isSpeechErrorKind(e.code) ? e.code : 'unavailable', detail);
}

export function createCapacitorSpeech(win: WinLike = globalThis.window): NativeSpeech {
  const p = plugin(win);
  let finish: (() => void) | null = null;

  return {
    async start(lang: string, events: SpeechEvents): Promise<void> {
      if (!p) {
        events.onError('unavailable', 'EmberSpeech plugin missing');
        events.onEnd();
        throw new SpeechStartError('unavailable', 'EmberSpeech plugin missing', 'no-bridge');
      }
      let ended = false;
      const handles: Array<Promise<ListenerHandle> | ListenerHandle> = [];
      const end = () => {
        if (ended) return;
        ended = true;
        finish = null;
        events.onEnd();
        // Capacitor 7 hands back Promise<PluginListenerHandle>; settle each
        // before removing it.
        for (const h of handles) {
          void Promise.resolve(h).then(
            (handle) => quiet(handle?.remove()),
            () => {},
          );
        }
      };
      finish = end;
      const on = <T>(name: string, cb: (d: T) => void) => {
        handles.push(p.addListener(name, ((d: T) => {
          if (!ended) cb(d);
        }) as (d: never) => void));
      };
      on<{ text?: unknown }>('partial', (d) => events.onPartial(typeof d?.text === 'string' ? d.text : ''));
      on<{ text?: unknown }>('final', (d) => events.onFinal(typeof d?.text === 'string' ? d.text : ''));
      on<{ kind?: unknown; detail?: unknown }>('error', (d) =>
        events.onError(toSpeechErrorKind(d?.kind), typeof d?.detail === 'string' ? d.detail : undefined),
      );
      on('end', end);
      // Listeners first, so nothing Kotlin sends right after start is lost.
      await Promise.all(handles.map((h) => Promise.resolve(h).catch(() => null)));
      try {
        await p.start({ lang });
      } catch (err) {
        const e = startError(err);
        if (!ended) events.onError(e.kind, e.detail);
        end();
        throw e;
      }
    },
    stop() {
      quiet(p?.stop());
    },
    abort() {
      quiet(p?.abort());
      // Kotlin sends end after a cancel, but a wedged bridge must not keep
      // the listeners alive.
      finish?.();
    },
  };
}
