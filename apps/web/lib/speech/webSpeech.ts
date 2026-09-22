import { SpeechStartError, type NativeSpeech, type SpeechErrorKind, type SpeechEvents } from './types';

// The Web Speech API has no lib.dom types: minimal local shapes, no `any`.
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

type WinLike = Window | undefined;

function getCtor(win: WinLike): SpeechRecognitionCtor | null {
  if (!win) return null;
  const w = win as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function webSpeechAvailable(win: WinLike = globalThis.window): boolean {
  return getCtor(win) !== null;
}

/** Web Speech error codes to our kinds; `detail` keeps the raw code for the
 *  logger when it is not one we name. */
export function mapWebSpeechError(error: string): { kind: SpeechErrorKind; detail?: string } {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { kind: 'permission-denied' };
    case 'network':
      return { kind: 'network' };
    case 'no-speech':
      return { kind: 'no-speech' };
    case 'aborted':
      return { kind: 'aborted' };
    default:
      // audio-capture, language-not-supported and anything newer.
      return { kind: 'unavailable', detail: error };
  }
}

/** Browser recognizer. Interim results on, one utterance per start: the
 *  browser auto-stops on silence, the accumulated text is sent every time. */
export function createWebSpeech(win: WinLike = globalThis.window): NativeSpeech {
  let rec: SpeechRecognitionLike | null = null;

  return {
    start(lang: string, events: SpeechEvents): Promise<void> {
      const Ctor = getCtor(win);
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        events.onEnd();
      };
      if (!Ctor) {
        events.onError('unavailable', 'no SpeechRecognition');
        end();
        return Promise.reject(new SpeechStartError('unavailable', 'no SpeechRecognition', 'no-recognizer'));
      }
      const r = new Ctor();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let text = '';
        let isFinal = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          isFinal = e.results[i].isFinal;
        }
        if (isFinal) events.onFinal(text);
        else events.onPartial(text);
      };
      r.onerror = (e) => {
        const { kind, detail } = mapWebSpeechError(e.error);
        events.onError(kind, detail);
      };
      r.onend = end;
      rec = r;
      try {
        r.start();
      } catch (err) {
        // start() throws InvalidStateError when a session is still running.
        const detail = err instanceof Error ? err.message : String(err);
        events.onError('unavailable', detail);
        end();
        return Promise.reject(new SpeechStartError('unavailable', detail));
      }
      return Promise.resolve();
    },
    stop() {
      rec?.stop();
    },
    abort() {
      rec?.abort();
    },
  };
}
