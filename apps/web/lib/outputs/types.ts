/** Where the music can come out: the Devices button's model (Spotify's
 *  device picker). One shape for every platform; each platform has its own
 *  provider (lib/outputs/providers) that fills it from what that platform
 *  can say:
 *
 *  - Android app: the phone's outputs from AudioManager, one pinned through
 *    Media3 (ExoPlayer.setPreferredAudioDevice), and the system Output
 *    Switcher for everything else (the EmberPlayer plugin).
 *  - iPhone app: only the current route (AVAudioSession); the system route
 *    picker (AVRoutePickerView) does the choosing (EmberAudioRoute plugin).
 *  - Desktop app: the native engine's output devices (cpal), switched
 *    without losing the playhead, remembered across launches.
 *  - Browser: HTMLMediaElement.setSinkId where the browser has it (Chrome on
 *    a computer), remembered in this browser. */

export type OutputKind =
  | 'computer'
  | 'phone'
  | 'speaker'
  | 'headphones'
  | 'bluetooth'
  | 'usb'
  | 'hdmi'
  | 'airplay'
  | 'car'
  | 'other';

export interface OutputDevice {
  id: string;
  name: string;
  kind: OutputKind;
  /** A second line, e.g. the device the system default is right now. */
  detail?: string;
}

export type OutputPlatform = 'android' | 'ios' | 'desktop' | 'web';

/** How this platform's own picker is reached, if it has one:
 *  - `android-switcher`: Android's Output Switcher (every speaker,
 *    headphone and cast device the system knows).
 *  - `ios-route-picker`: AirPlay and Bluetooth, iOS's route picker.
 *  - `web-select`: the browser's own speaker prompt (selectAudioOutput).
 *  - `web-permission`: Chrome lists speakers by name only once the page
 *    may use the microphone. */
export type SystemPicker = 'android-switcher' | 'ios-route-picker' | 'web-select' | 'web-permission';

export interface OutputSnapshot {
  devices: OutputDevice[];
  /** The row to highlight: the device picked, or the "system default" row. */
  currentId: string | null;
  /** Where the sound comes out right now, by name ("Pixel Buds"). */
  currentName: string | null;
  currentKind: OutputKind | null;
  systemPicker: SystemPicker | null;
}

/** A cast device the Android app found on the network (MediaRouter). */
export interface CastDevice {
  id: string;
  name: string;
  description: string | null;
  selected: boolean;
  connecting: boolean;
}

/** What each platform's provider does. `snapshot` answers null when this
 *  platform (or this build of the app) cannot switch outputs at all. */
export interface OutputProvider {
  platform: OutputPlatform;
  snapshot(): Promise<OutputSnapshot | null>;
  /** null: back to the system's own choice. */
  select(id: string | null): Promise<OutputSnapshot | null>;
  openSystemPicker?(): Promise<OutputSnapshot | null>;
  /** Changes the platform reports by itself (a headset plugged in, the
   *  route picker used, a device gone). Returns the unsubscribe. */
  watch(onChange: (s: OutputSnapshot) => void): () => void;
}

/** The desktop and browser "follow the system" row. */
export const SYSTEM_DEFAULT_ID = 'system-default';
