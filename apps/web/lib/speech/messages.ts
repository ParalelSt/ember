import type { Shell } from '@/lib/playback/detectShell';
import type { SpeechErrorKind, SpeechUnavailableReason } from './types';

export const MSG_PERMISSION = 'Allow microphone access to use voice search.';
export const MSG_WEB_UNSUPPORTED = "Voice search isn't supported in this browser: try Chrome.";
export const MSG_UPDATE_APP = 'Update the Ember app to use voice search.';
export const MSG_NO_RECOGNIZER = "Voice search isn't available on this device.";
export const MSG_NETWORK = 'Voice search needs an internet connection right now.';
export const MSG_SPEECH_SETTING_OFF =
  'Turn on Online speech recognition in Windows Settings (Privacy & security, Speech) to use voice search.';

/** Toast copy for a speech error, or null when it should stay quiet. */
export function speechErrorMessage(
  kind: SpeechErrorKind,
  shell: Shell,
  reason?: SpeechUnavailableReason,
): string | null {
  switch (kind) {
    case 'permission-denied':
      return MSG_PERMISSION;
    case 'unavailable':
      if (shell === 'web') return MSG_WEB_UNSUPPORTED;
      return reason === 'no-bridge' ? MSG_UPDATE_APP : MSG_NO_RECOGNIZER;
    case 'network':
      return MSG_NETWORK;
    case 'speech-setting-off':
      return MSG_SPEECH_SETTING_OFF;
    case 'no-speech':
    case 'aborted':
      return null;
  }
}
