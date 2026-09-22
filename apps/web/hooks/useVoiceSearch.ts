'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger/client';
import { detectShell } from '@/lib/playback/detectShell';
import { speechErrorMessage } from '@/lib/speech/messages';
import { selectSpeechAdapter } from '@/lib/speech/selectAdapter';
import { createSpeechSession, type SpeechSession } from '@/lib/speech/session';
import { SpeechStartError, type SpeechErrorKind } from '@/lib/speech/types';

/** Voice input for the search box. `onTranscript` fires with the accumulated
 *  text as the user speaks (interim) and once more with `isFinal = true`;
 *  recognition auto-stops on silence. The recognizer is the browser's Web
 *  Speech API on the web and the OS one inside the apps (see lib/speech).
 *  `supported` is false during SSR and wherever no adapter fits. */
const subscribeNever = () => () => {};

/** Kinds the user caused or expects; everything else is worth a log line. */
const QUIET_LOG: ReadonlySet<SpeechErrorKind> = new Set(['no-speech', 'aborted', 'permission-denied']);

export function useVoiceSearch(onTranscript: (text: string, isFinal: boolean) => void) {
  // Hydration-safe support probe: false on the server (and for React's initial
  // client render), the real answer immediately after, no setState-in-effect.
  const supported = useSyncExternalStore(
    subscribeNever,
    () => selectSpeechAdapter().adapter !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<SpeechSession | null>(null);
  // Ref'd so toggle/handlers stay stable without rebinding per keystroke.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    return () => sessionRef.current?.abort();
  }, []);

  const toggle = useCallback(() => {
    // A session that is starting or listening: a second tap means stop.
    if (sessionRef.current) {
      sessionRef.current.stop();
      return;
    }
    const { adapter } = selectSpeechAdapter();
    if (!adapter) return;
    const shell = detectShell();
    const lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';

    let ended = false;
    let starting = true;
    // Errors raised while start() is pending wait for its rejection, which
    // carries the reason (an old shell says "update the app").
    let pending: { kind: SpeechErrorKind; detail?: string } | null = null;

    const report = (kind: SpeechErrorKind, detail?: string, reason?: SpeechStartError['reason']) => {
      const msg = speechErrorMessage(kind, shell, reason);
      if (msg) toast.error(msg);
      if (!QUIET_LOG.has(kind)) logger.error('voice', 'speech recognition error', { kind, detail });
    };

    const session = createSpeechSession(adapter, {
      lang,
      events: {
        onPartial(text) {
          if (text) onTranscriptRef.current(text, false);
        },
        onFinal(text) {
          if (text) onTranscriptRef.current(text, true);
        },
        onError(kind, detail) {
          if (starting) pending = { kind, detail };
          else report(kind, detail);
        },
        onEnd() {
          ended = true;
          if (sessionRef.current === session) sessionRef.current = null;
          setListening(false);
        },
      },
    });
    sessionRef.current = session;

    session.start().then(
      () => {
        starting = false;
        if (pending) report(pending.kind, pending.detail);
        if (!ended) setListening(true);
      },
      (err: unknown) => {
        starting = false;
        const reason = err instanceof SpeechStartError ? err.reason : undefined;
        const kind = pending?.kind ?? (err instanceof SpeechStartError ? err.kind : 'unavailable');
        const detail = pending?.detail ?? (err instanceof Error ? err.message : String(err));
        report(kind, detail, reason);
      },
    );
  }, []);

  return { supported, listening, toggle };
}
