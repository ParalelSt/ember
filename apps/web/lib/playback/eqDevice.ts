import { detectShell } from './detectShell';
import { androidPluginPresent } from './androidBackend';
import type { BackendKind } from '@/lib/autoCache/select';
import type { EqSettings } from './eq';

/** Where the equalizer needs the listener's say-so on this very device.
 *
 *  Web audio filters through a Web Audio graph, and on a phone that graph
 *  can stop the music when the screen turns off (webBackend). The desktop
 *  engine and the Android app's native player filter natively and have no
 *  such problem. So on a phone playing through web audio (a phone browser,
 *  or an Android app build from before the native player), the account's
 *  equalizer is only applied once it has been chosen there: switching it on
 *  on the desktop must not quietly cost the phone its background playback. */

const coarsePointer = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/** For the engine that is playing (PlayerProvider). */
export function eqNeedsConsent(kind: BackendKind | null): boolean {
  return (kind === 'web' || kind === 'capacitor') && coarsePointer();
}

/** For this page before it knows its engine (Settings), from the shell. */
export function phoneWebAudio(): boolean {
  if (typeof window === 'undefined') return false;
  const shell = detectShell();
  if (shell === 'tauri') return false;
  if (shell === 'capacitor' && androidPluginPresent()) return false;
  return coarsePointer();
}

/** What the engine should get: the account's setting, or off where this
 *  device has not chosen it (see above). */
export function eqForDevice(eq: EqSettings, needsConsent: boolean, chosenHere: boolean): EqSettings {
  return needsConsent && !chosenHere && eq.enabled ? { ...eq, enabled: false } : eq;
}
