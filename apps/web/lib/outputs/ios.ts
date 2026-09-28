import type { OutputKind, OutputProvider, OutputSnapshot } from './types';

/** The iPhone app: iOS does not let an app list or pick outputs itself.
 *  The EmberAudioRoute plugin (apps/mobile/ios, Swift) reports where the
 *  audio goes now (AVAudioSession's current route) and opens the system
 *  route picker (AVRoutePickerView: AirPlay, Bluetooth, the phone). The web
 *  page's own audio follows the app's route. An app build from before the
 *  plugin has no picker. */

export interface IosRoute {
  name: string;
  kind: string;
  airplay?: boolean;
}

interface ListenerHandle {
  remove?: () => unknown;
}

interface RoutePlugin {
  getRoute(): Promise<IosRoute>;
  showRoutePicker(): Promise<void>;
  addListener(event: 'route', cb: (r: IosRoute) => void): Promise<ListenerHandle> | ListenerHandle;
}

export function iosRoutePlugin(): RoutePlugin | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { Capacitor?: { Plugins?: { EmberAudioRoute?: Partial<RoutePlugin> } } })
    .Capacitor?.Plugins?.EmberAudioRoute;
  return p && typeof p.getRoute === 'function' && typeof p.showRoutePicker === 'function' && typeof p.addListener === 'function'
    ? (p as RoutePlugin)
    : null;
}

const KINDS: Record<string, OutputKind> = {
  speaker: 'phone',
  headphones: 'headphones',
  bluetooth: 'bluetooth',
  airplay: 'airplay',
  car: 'car',
  usb: 'usb',
  hdmi: 'hdmi',
};

/** The only row iOS can show is the route in use. */
export const IOS_ROUTE_ID = 'current-route';

export function iosSnapshot(raw: IosRoute): OutputSnapshot {
  const kind = raw?.airplay ? 'airplay' : KINDS[raw?.kind] ?? 'other';
  const name = raw?.name || (kind === 'phone' ? 'This iPhone' : 'Audio output');
  return {
    devices: [{ id: IOS_ROUTE_ID, name, kind }],
    currentId: IOS_ROUTE_ID,
    currentName: name,
    currentKind: kind,
    systemPicker: 'ios-route-picker',
  };
}

export function createIosOutputs(p: RoutePlugin): OutputProvider {
  const snapshot = async () => {
    try {
      return iosSnapshot(await p.getRoute());
    } catch {
      return null;
    }
  };
  const openPicker = async () => {
    await p.showRoutePicker();
    return snapshot();
  };
  return {
    platform: 'ios',
    snapshot,
    // Nothing to pick in-app: a tap on the route opens the system's picker.
    select: () => openPicker(),
    openSystemPicker: openPicker,
    watch(onChange) {
      let handle: ListenerHandle | null = null;
      let done = false;
      try {
        void Promise.resolve(p.addListener('route', (r) => onChange(iosSnapshot(r))))
          .then((h) => {
            if (done) void h?.remove?.();
            else handle = h;
          })
          .catch(() => {});
      } catch {
        /* a broken bridge must not break the player */
      }
      return () => {
        done = true;
        void handle?.remove?.();
      };
    },
  };
}
