export type SpeechErrorKind =
  | 'permission-denied' // mic or speech permission refused by the OS
  | 'unavailable' // no recognizer on this device, or an old shell without the bridge
  | 'network' // recognizer needs the network and has none
  | 'speech-setting-off' // Windows only: "online speech recognition" privacy toggle is off
  | 'no-speech' // silence / nothing recognised (quiet, no toast)
  | 'aborted'; // we cancelled it ourselves (quiet)

export interface SpeechEvents {
  /** Full text so far (not a delta), may be called many times. */
  onPartial(text: string): void;
  /** Full final text; at most once per start; followed by onEnd. */
  onFinal(text: string): void;
  /** At most once per start; followed by onEnd. `detail` is for the logger, never shown. */
  onError(kind: SpeechErrorKind, detail?: string): void;
  /** Exactly once per start, after final or error or a plain stop. */
  onEnd(): void;
}

export interface NativeSpeech {
  /** Begins listening; rejects only when it could not even begin (the reason is also sent through onError). */
  start(lang: string, events: SpeechEvents): Promise<void>;
  /** Stop capturing; the recogniser still delivers its final result, then onEnd. */
  stop(): void;
  /** Drop everything now; no final, then onEnd (kind 'aborted' is NOT emitted as an error). */
  abort(): void;
}

export type SpeechAdapterKind = 'web' | 'capacitor' | 'tauri';
export interface SpeechAdapter {
  kind: SpeechAdapterKind;
  create(): NativeSpeech;
}

/** Why a shell has no working recognizer: an app build without the bridge
 *  (tell the user to update) or a device without a recognizer. */
export type SpeechUnavailableReason = 'no-bridge' | 'no-recognizer';

const KINDS: readonly SpeechErrorKind[] = [
  'permission-denied',
  'unavailable',
  'network',
  'speech-setting-off',
  'no-speech',
  'aborted',
];

/** Native layers send kinds as plain strings; anything unknown is 'unavailable'. */
export function toSpeechErrorKind(value: unknown): SpeechErrorKind {
  return KINDS.includes(value as SpeechErrorKind) ? (value as SpeechErrorKind) : 'unavailable';
}

export function isSpeechErrorKind(value: unknown): value is SpeechErrorKind {
  return KINDS.includes(value as SpeechErrorKind);
}

/** What an adapter's start() rejects with, so the hook can pick the toast
 *  copy (an old shell gets "update the app", not "not available"). */
export class SpeechStartError extends Error {
  readonly kind: SpeechErrorKind;
  readonly reason?: SpeechUnavailableReason;
  readonly detail?: string;
  constructor(kind: SpeechErrorKind, detail?: string, reason?: SpeechUnavailableReason) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = 'SpeechStartError';
    this.kind = kind;
    this.detail = detail;
    this.reason = reason;
  }
}
