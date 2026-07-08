'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger/client';

// The Web Speech API has no lib.dom types — minimal local shapes, no `any`.
interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechResultAlternative;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface SpeechErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Browser voice input for the search box. `onTranscript` fires with the
 *  accumulated text as the user speaks (interim) and once more with
 *  `isFinal = true`; recognition auto-stops on silence. `supported` is false
 *  during SSR and wherever the Web Speech API is missing (Firefox, the app
 *  WebView for now) — callers hide the mic entirely there. */
const subscribeNever = () => () => {};

export function useVoiceSearch(onTranscript: (text: string, isFinal: boolean) => void) {
  // Hydration-safe support probe: false on the server (and for React's initial
  // client render), the real answer immediately after — no setState-in-effect.
  const supported = useSyncExternalStore(subscribeNever, () => getCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Ref'd so toggle/handlers stay stable without rebinding per keystroke.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    return () => recRef.current?.abort();
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = '';
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        isFinal = e.results[i].isFinal;
      }
      if (text) onTranscriptRef.current(text, isFinal);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Allow microphone access to use voice search.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        logger.error('voice', 'speech recognition error', { error: e.error });
      }
      setListening(false);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening]);

  return { supported, listening, toggle };
}
