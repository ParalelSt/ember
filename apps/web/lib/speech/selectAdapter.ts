import { detectShell, type Shell } from '@/lib/playback/detectShell';
import type { SpeechAdapter, SpeechUnavailableReason } from './types';
import { capacitorSpeechPresent, createCapacitorSpeech } from './capacitorSpeech';
import { createTauriSpeech, tauriSpeechPresent } from './tauriSpeech';
import { createWebSpeech, webSpeechAvailable } from './webSpeech';

export interface SpeechAdapterPick {
  adapter: SpeechAdapter | null;
  reason?: SpeechUnavailableReason;
}

/** Picks the recognizer for this runtime. Inside a shell only the native
 *  adapter is ever used: WebView2 and Android WebView expose
 *  webkitSpeechRecognition but every session fails with 'network', and an
 *  old shell must say "update the app" instead. */
export function selectSpeechAdapter(
  shell: Shell = detectShell(),
  win: Window | undefined = globalThis.window,
): SpeechAdapterPick {
  if (shell === 'web') {
    if (!webSpeechAvailable(win)) return { adapter: null, reason: 'no-recognizer' };
    return { adapter: { kind: 'web', create: () => createWebSpeech(win) } };
  }
  if (shell === 'capacitor' && capacitorSpeechPresent(win)) {
    return { adapter: { kind: 'capacitor', create: () => createCapacitorSpeech(win) } };
  }
  if (shell === 'tauri' && tauriSpeechPresent(win)) {
    return { adapter: { kind: 'tauri', create: createTauriSpeech } };
  }
  return { adapter: null, reason: 'no-bridge' };
}
