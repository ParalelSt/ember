import { nativePlatform } from '@/lib/playback/nativePlatform';

/** The Discord switch on its way to the Android app (EmberDiscord,
 *  DiscordSharing.kt), which keeps it on disk.
 *
 *  On Android the player service publishes the card itself: the page can be
 *  frozen or gone while the music plays (PageStateGate.kt), and in the car
 *  there may never have been one. All the page has to say is whether sharing
 *  is allowed. An Android app from before this plugin has none, and shows no
 *  card. Never throws. */

interface EmberDiscordPlugin {
  setSharing?: (args: { enabled: boolean }) => Promise<unknown>;
}
type CapWindow = { Capacitor?: { Plugins?: { EmberDiscord?: EmberDiscordPlugin } } };

/** True when the card belongs to the Android app, not to this page. */
export function androidOwnsDiscord(): boolean {
  return nativePlatform() === 'android';
}

export function setAndroidDiscordSharing(enabled: boolean): void {
  if (!androidOwnsDiscord()) return;
  try {
    const plugin = (window as unknown as CapWindow).Capacitor?.Plugins?.EmberDiscord;
    void plugin?.setSharing?.({ enabled })?.catch?.(() => {});
  } catch {
    // The app's plugin bridge refused: the switch stays as it was.
  }
}
