import { nativePlatform } from '@/lib/playback/nativePlatform';

/** The Android app's in-app updater, as the page sees it (the EmberUpdate
 *  plugin, apps/mobile/android/.../EmberUpdatePlugin.kt). The app checks,
 *  downloads and installs by itself; the page only shows where that is
 *  ("Downloading update", "Update ready, tap to install") and passes on the
 *  person's taps. Nothing here exists in a browser, the desktop app, the
 *  iPhone app, or an Android app from before the updater: every function
 *  then does nothing and never throws. */

export type AppUpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'installing' | 'failed';
/** What a ready update waits for: the car to go, the music to stop, a few
 *  idle minutes, a tap, or the "Install unknown apps" switch. */
export type AppUpdateWaiting = 'car' | 'playback' | 'idle' | 'tap' | 'permission';

export interface AppUpdateState {
  status: AppUpdateStatus;
  current: string | null;
  latest: string | null;
  /** 0..1 while downloading. */
  progress: number | null;
  waiting: AppUpdateWaiting | null;
  error: string | null;
  checkedAt: number;
  needsPermission: boolean;
  /** Android will install without a dialog. */
  silent: boolean;
}

export const IDLE_UPDATE_STATE: AppUpdateState = {
  status: 'idle',
  current: null,
  latest: null,
  progress: null,
  waiting: null,
  error: null,
  checkedAt: 0,
  needsPermission: false,
  silent: false,
};

const STATUSES: readonly AppUpdateStatus[] = ['idle', 'checking', 'up-to-date', 'downloading', 'ready', 'installing', 'failed'];
const WAITS: readonly AppUpdateWaiting[] = ['car', 'playback', 'idle', 'tap', 'permission'];

function str(v: unknown, max = 80): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** Whatever the plugin sent, as a well-formed state. */
export function readUpdateState(raw: unknown): AppUpdateState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = STATUSES.includes(o.status as AppUpdateStatus) ? (o.status as AppUpdateStatus) : 'idle';
  const waiting = WAITS.includes(o.waiting as AppUpdateWaiting) ? (o.waiting as AppUpdateWaiting) : null;
  const p = typeof o.progress === 'number' && Number.isFinite(o.progress) ? Math.min(1, Math.max(0, o.progress)) : null;
  return {
    status,
    current: str(o.current, 40),
    latest: str(o.latest, 40),
    progress: p,
    waiting,
    error: str(o.error, 200),
    checkedAt: typeof o.checkedAt === 'number' && Number.isFinite(o.checkedAt) ? o.checkedAt : 0,
    needsPermission: o.needsPermission === true,
    silent: o.silent === true,
  };
}

type Handle = { remove: () => void | Promise<void> };
interface EmberUpdatePlugin {
  getState?: () => Promise<unknown>;
  check?: () => Promise<unknown>;
  install?: () => Promise<unknown>;
  openInstallSettings?: () => Promise<unknown>;
  addListener?: (event: 'updateState', cb: (s: unknown) => void) => Promise<Handle> | Handle;
}
type CapWindow = { Capacitor?: { Plugins?: { EmberUpdate?: EmberUpdatePlugin } } };

function plugin(): EmberUpdatePlugin | null {
  if (typeof window === 'undefined' || nativePlatform() !== 'android') return null;
  const p = (window as unknown as CapWindow).Capacitor?.Plugins?.EmberUpdate;
  return p && typeof p.getState === 'function' ? p : null;
}

/** Only in the Android app, and only one with the updater in it. */
export function appUpdateAvailable(): boolean {
  return plugin() !== null;
}

/** Follows the updater's state: the current one at once, then every change.
 *  Returns the unsubscribe. */
export function subscribeAppUpdate(cb: (s: AppUpdateState) => void): () => void {
  const p = plugin();
  if (!p) return () => {};
  let live = true;
  let handle: Handle | null = null;
  const emit = (d: unknown) => {
    if (live) cb(readUpdateState(d));
  };
  try {
    const h = p.addListener?.('updateState', emit);
    if (h && typeof (h as Promise<Handle>).then === 'function') {
      (h as Promise<Handle>).then(
        (x) => {
          if (live) handle = x;
          else void x?.remove?.();
        },
        () => {},
      );
    } else if (h && typeof (h as Handle).remove === 'function') {
      handle = h as Handle;
    }
  } catch {
    /* an older bridge: the state below still arrives */
  }
  p.getState?.().then(emit, () => {});
  return () => {
    live = false;
    try {
      void handle?.remove();
    } catch {
      /* the bridge is going away with the WebView */
    }
  };
}

async function call(name: 'check' | 'install' | 'openInstallSettings'): Promise<boolean> {
  const fn = plugin()?.[name];
  if (typeof fn !== 'function') return false;
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

export const checkForAppUpdate = () => call('check');
export const installAppUpdate = () => call('install');
export const openInstallSettings = () => call('openInstallSettings');

export type UpdatePillAction = 'install' | 'settings' | null;
export interface UpdatePill {
  title: string;
  detail: string | null;
  action: UpdatePillAction;
  /** May be put away for this visit (a download or a wait can). */
  dismissable: boolean;
}

/** The small floating line over the app, or null when there is nothing to
 *  say. A check, "up to date" and a failed check are Settings' business,
 *  not worth interrupting anyone for. */
export function updatePill(s: AppUpdateState): UpdatePill | null {
  const v = s.latest ? ` ${s.latest}` : '';
  switch (s.status) {
    case 'downloading':
      return {
        title: `Downloading update${v}`,
        detail: s.progress !== null ? `${Math.round(s.progress * 100)}%` : null,
        action: null,
        dismissable: true,
      };
    case 'installing':
      return { title: `Updating Ember${v}`, detail: 'Ember restarts when it is done', action: null, dismissable: false };
    case 'ready':
      switch (s.waiting) {
        case 'permission':
          return {
            title: `Update${v} ready`,
            detail: 'Allow Ember to install updates',
            action: 'settings',
            dismissable: true,
          };
        case 'car':
          return { title: `Update${v} ready`, detail: "Installs when you're parked", action: null, dismissable: true };
        case 'playback':
        case 'idle':
          return {
            title: `Update${v} ready`,
            detail: 'Installs when the music stops, or tap to install now',
            action: 'install',
            dismissable: true,
          };
        default:
          return { title: `Update${v} ready`, detail: 'Tap to install', action: 'install', dismissable: true };
      }
    default:
      return null;
  }
}

/** Settings' one line about updates. */
export function updateLine(s: AppUpdateState): string {
  const v = s.latest ? ` ${s.latest}` : '';
  switch (s.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Ember is up to date';
    case 'downloading':
      return `Downloading update${v}${s.progress !== null ? ` (${Math.round(s.progress * 100)}%)` : ''}`;
    case 'installing':
      return `Installing update${v}`;
    case 'ready': {
      const pill = updatePill(s);
      return pill?.detail ? `Update${v} ready. ${pill.detail}` : `Update${v} ready`;
    }
    case 'failed':
      return s.error ?? "Couldn't check for updates";
    default:
      return 'Ember checks for updates by itself every few hours';
  }
}
