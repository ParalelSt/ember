import 'server-only';
import type PocketBase from 'pocketbase';
import { isUpdateConfigured, latestReleaseWithin, releaseVersion } from '@/lib/desktopUpdate';
import { serverLogger } from '@/lib/logger/server';
import { parsePbDate, pbDate } from '@/lib/pocketbase/dates';
import { isNewer } from '@/lib/semver';
import { RELEASE_PLATFORMS } from '@/lib/updatePolicy';
import { sanitizePlatform, sanitizeVersion, type DevicePlatform } from './label';

/** The user_devices collection: which versions each member's devices run.
 *  Superuser-only rules, so everything goes through here with the admin
 *  client (pocketbase/pb_migrations/1793000000_user_devices.js). */

/** A row is rewritten at most this often unless a version changed. Matches
 *  the device's own SEEN_EVERY_MS. */
export const SEEN_WRITE_EVERY_MS = 6 * 60 * 60 * 1000;
/** Oldest rows go first: a browser that keeps clearing its storage makes a
 *  new "device" each time. */
export const MAX_DEVICES_PER_USER = 10;
/** The Users page waits this long at most on the GitHub release list; after
 *  that it compares with the newest version seen (the lookup still warms the
 *  cache for the next load). */
const RELEASE_LOOKUP_MS = 1500;

export interface DeviceReport {
  deviceId: string;
  platform: DevicePlatform;
  shellVersion: string | null;
  webVersion: string | null;
}

/** Checks a device's note; null when it is not one. A browser has no shell,
 *  whatever the body says. */
export function parseDeviceReport(body: unknown): DeviceReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(b.deviceId)) return null;
  const platform = sanitizePlatform(b.platform);
  if (!platform) return null;
  return {
    deviceId: b.deviceId,
    platform,
    shellVersion: platform === 'browser' ? null : sanitizeVersion(b.shellVersion),
    webVersion: sanitizeVersion(b.webVersion),
  };
}

/** Saves a note. Answers true when it wrote something, false when the row was
 *  already up to date. */
export async function saveDeviceSeen(
  pb: PocketBase,
  userId: string,
  report: DeviceReport,
  now: number = Date.now(),
): Promise<boolean> {
  const devices = pb.collection('user_devices');
  const rows = await devices.getFullList({ filter: `user = "${userId}"`, sort: '-last_seen', requestKey: null });
  const fields = {
    platform: report.platform,
    shell_version: report.shellVersion ?? '',
    web_version: report.webVersion ?? '',
    last_seen: pbDate(now),
  };

  const existing = rows.find((r) => r.device_key === report.deviceId);
  if (existing) {
    const unchanged =
      existing.platform === fields.platform &&
      (existing.shell_version ?? '') === fields.shell_version &&
      (existing.web_version ?? '') === fields.web_version;
    const age = now - parsePbDate(existing.last_seen);
    if (unchanged && age >= 0 && age < SEEN_WRITE_EVERY_MS) return false;
    await devices.update(existing.id, fields, { requestKey: null });
    return true;
  }

  try {
    await devices.create({ user: userId, device_key: report.deviceId, ...fields }, { requestKey: null });
  } catch (e) {
    // Two tabs at once: the other one's row is the same news.
    const again = await devices.getList(1, 1, {
      filter: `user = "${userId}" && device_key = "${report.deviceId}"`,
      requestKey: null,
    });
    if (again.items.length > 0) return false;
    throw e;
  }
  for (const old of rows.slice(MAX_DEVICES_PER_USER - 1)) {
    await devices.delete(old.id, { requestKey: null }).catch(() => undefined);
  }
  return true;
}

export interface SeenDevice {
  id: string;
  userId: string;
  platform: DevicePlatform;
  shellVersion: string | null;
  webVersion: string | null;
  lastSeen: string;
}

/** Every member's devices, newest first. Empty when they cannot be read (a
 *  host that has not restarted PocketBase yet): the Users page still works. */
export async function listDevices(pb: PocketBase): Promise<SeenDevice[]> {
  try {
    const rows = await pb.collection('user_devices').getFullList({ sort: '-last_seen', requestKey: null });
    const out: SeenDevice[] = [];
    for (const r of rows) {
      const platform = sanitizePlatform(r.platform);
      if (!platform || typeof r.user !== 'string') continue;
      out.push({
        id: r.id,
        userId: r.user,
        platform,
        shellVersion: sanitizeVersion(r.shell_version),
        webVersion: sanitizeVersion(r.web_version),
        lastSeen: String(r.last_seen ?? ''),
      });
    }
    return out;
  } catch (e) {
    serverLogger.warn('api', 'admin/users: could not read user_devices', { digest: false }, e);
    return [];
  }
}

export type NewestShells = Partial<Record<DevicePlatform, string>>;

/** The newest published release per platform, from the same cached list as
 *  the update feeds. Empty when the host has no release token or GitHub is too
 *  slow right now. */
export async function newestReleases(): Promise<NewestShells> {
  if (!isUpdateConfigured()) return {};
  const out: NewestShells = {};
  await Promise.all(
    RELEASE_PLATFORMS.map(async (platform) => {
      const release = await latestReleaseWithin(RELEASE_LOOKUP_MS, platform).catch(() => null);
      const version = release ? sanitizeVersion(releaseVersion(release)) : null;
      if (version) out[platform] = version;
    }),
  );
  return out;
}

export interface ComparedDevice extends SeenDevice {
  newestShell: string | null;
  newestWeb: string | null;
  shellBehind: boolean;
  webBehind: boolean;
}

/** Only real x.y.z numbers compare: isNewer reads anything else as 0.0.0. */
const isComparable = (v: string) => /^\d+\.\d+\.\d+/.test(v);

function newestOf(versions: (string | null)[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (v && isComparable(v) && (!best || isNewer(v, best))) best = v;
  }
  return best;
}

const isBehind = (version: string | null, newest: string | null) =>
  !!version && !!newest && isComparable(version) && isNewer(newest, version);

/** Marks each device against the newest release (the shell) and what this
 *  server runs (the web build). Without those it compares with the newest
 *  version seen on any device, so it still says something. A shell that cannot
 *  say its version is not marked: the page shows it as unknown. */
export function compareDevices(
  devices: SeenDevice[],
  known: { shells: NewestShells; web: string | null },
): ComparedDevice[] {
  const newestWeb = known.web ?? newestOf(devices.map((d) => d.webVersion));
  return devices.map((d) => {
    const newestShell =
      d.platform === 'browser'
        ? null
        : (known.shells[d.platform] ??
          newestOf(devices.filter((o) => o.platform === d.platform).map((o) => o.shellVersion)));
    return {
      ...d,
      newestShell,
      newestWeb,
      shellBehind: isBehind(d.shellVersion, newestShell),
      webBehind: isBehind(d.webVersion, newestWeb),
    };
  });
}
