import { logger } from '@/lib/logger/client';
import { detectShell } from '@/lib/playback/detectShell';
import { shellAppVersion } from '@/lib/shellVersion';
import { sanitizeVersion, type DevicePlatform } from './label';

/** This device's half of "who runs what": what it is, and one rare, silent
 *  note to the server (POST /api/devices/seen). Nothing here may ever get in
 *  the way of music: every failure just means "try again next time". */

/** At most one note per device in this long, unless a version changed. The
 *  server holds to the same figure. */
export const SEEN_EVERY_MS = 6 * 60 * 60 * 1000;

/** The EmberApp plugin is asked once; a call that never answers must not hold
 *  up a report. */
const SHELL_VERSION_BUDGET_MS = 1500;

const DEVICE_ID_KEY = 'ember.device.id';
const LAST_SEEN_KEY = 'ember.device.seen';
/** No storage (a locked-down browser): one shared row for the member's such
 *  browsers rather than a new row on every load. */
const NO_STORAGE_ID = 'no-storage';

export interface DeviceInfo {
  platform: DevicePlatform;
  shellVersion: string | null;
  webVersion: string | null;
}

export function detectDevicePlatform(): DevicePlatform {
  const w = (typeof window === 'undefined' ? {} : window) as { Capacitor?: { getPlatform?: () => string } };
  switch (detectShell()) {
    case 'capacitor':
      return w.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
    case 'tauri': {
      const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
      if (/Windows/i.test(ua)) return 'windows';
      if (/Mac/i.test(ua)) return 'macos';
      return 'linux';
    }
    default:
      return 'browser';
  }
}

async function shellVersionInTime(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SHELL_VERSION_BUDGET_MS);
  });
  try {
    return await Promise.race([shellAppVersion(), late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let loaded: Promise<DeviceInfo> | null = null;

/** What this device runs, looked up once. It also puts the shell's half into
 *  the logger's context, which every report's snapshot reads: a report path
 *  awaits this right before its snapshot. Never rejects. */
export function loadDeviceInfo(): Promise<DeviceInfo> {
  loaded ??= (async () => {
    const info: DeviceInfo = {
      platform: detectDevicePlatform(),
      shellVersion: sanitizeVersion(await shellVersionInTime()),
      webVersion: sanitizeVersion(process.env.NEXT_PUBLIC_APP_VERSION),
    };
    try {
      logger.setContext({ shellPlatform: info.platform, shellVersion: info.shellVersion });
    } catch {
      // A report without the shell's half still goes out.
    }
    return info;
  })();
  return loaded;
}

/** This device's random id, made up on first use. Opaque: it says nothing
 *  about the device and only tells two of a member's devices apart. */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const fresh = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return NO_STORAGE_ID;
  }
}

function readLastSeen(): { sig: string; at: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? 'null') as { sig?: unknown; at?: unknown } | null;
    return raw && typeof raw.sig === 'string' && typeof raw.at === 'number' ? { sig: raw.sig, at: raw.at } : null;
  } catch {
    return null;
  }
}

function writeLastSeen(sig: string, at: number): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ sig, at }));
  } catch {
    // Without storage the server's own check keeps the writes rare.
  }
}

let sending = false;

/** Tells the server what this device runs, when a version changed or the last
 *  note is old enough. Resolves true only when a note was taken. Never
 *  throws. */
export async function reportDeviceSeen(userId: string, now: number = Date.now()): Promise<boolean> {
  if (sending) return false;
  sending = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const info = await loadDeviceInfo();
    const sig = [userId, info.platform, info.shellVersion, info.webVersion].join('|');
    const last = readLastSeen();
    if (last && last.sig === sig && last.at <= now && now - last.at < SEEN_EVERY_MS) return false;
    const res = await fetch('/api/devices/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deviceId: deviceId(), ...info }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (!res.ok || body?.ok !== true) return false;
    writeLastSeen(sig, now);
    return true;
  } catch {
    return false;
  } finally {
    sending = false;
  }
}

/** Test seam: forgets the looked-up device and any note under way. */
export function resetDeviceInfoForTests(): void {
  loaded = null;
  sending = false;
}
