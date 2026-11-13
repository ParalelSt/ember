// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { pbDate } from '@/lib/pocketbase/dates';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), error: vi.fn() } }));

const update = vi.hoisted(() => ({ configured: false, releases: {} as Record<string, string | undefined> }));
vi.mock('@/lib/desktopUpdate', () => ({
  isUpdateConfigured: () => update.configured,
  latestReleaseWithin: async (_ms: number, platform: string) => {
    if (update.releases[platform] === 'throws') throw new Error('nope');
    return update.releases[platform] ? { tag_name: `${platform}-v${update.releases[platform]}` } : null;
  },
  releaseVersion: (r: { tag_name: string }) => r.tag_name.replace(/^.*-v/, ''),
}));

const { compareDevices, listDevices, MAX_DEVICES_PER_USER, newestReleases, parseDeviceReport, saveDeviceSeen, SEEN_WRITE_EVERY_MS } = await import('./store');
const { serverLogger } = await import('@/lib/logger/server');

const NOW = Date.UTC(2026, 9, 30, 12);
const report = { deviceId: 'device-aaaa', platform: 'android' as const, shellVersion: '0.4.28', webVersion: '0.7.34' };

function fakePb(rows: Record<string, unknown>[], { createThrows = false, afterCreateFail = [] as unknown[] } = {}) {
  const devices = {
    getFullList: vi.fn(async () => rows),
    getList: vi.fn(async () => ({ items: afterCreateFail })),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => {
      if (createThrows) throw new Error('unique');
      return {};
    }),
    delete: vi.fn(async () => true),
  };
  return { pb: { collection: () => devices } as unknown as PocketBase, devices };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  user: 'u1',
  device_key: report.deviceId,
  platform: 'android',
  shell_version: '0.4.28',
  web_version: '0.7.34',
  last_seen: pbDate(NOW - 60_000),
  ...over,
});

describe('parseDeviceReport', () => {
  const body = { deviceId: 'device-aaaa', platform: 'android', shellVersion: '0.4.28', webVersion: '0.7.34 (abc 2026-10-22)' };

  it('takes a good note and cleans the build stamp', () => {
    expect(parseDeviceReport(body)).toEqual(report);
  });

  it('refuses what is not one', () => {
    for (const bad of [null, 'x', [], {}, { ...body, deviceId: 'short' }, { ...body, deviceId: 'has spaces in it' }, { ...body, deviceId: 'a'.repeat(65) }, { ...body, deviceId: 'x" || user != "' }, { ...body, platform: 'toaster' }]) {
      expect(parseDeviceReport(bad)).toBeNull();
    }
  });

  it('keeps a note with a bad version, without the version', () => {
    expect(parseDeviceReport({ ...body, shellVersion: '<@1>', webVersion: 7 })).toEqual({ ...report, shellVersion: null, webVersion: null });
  });

  it('a browser has no shell, whatever it says', () => {
    expect(parseDeviceReport({ ...body, platform: 'browser' })!.shellVersion).toBeNull();
  });
});

describe('saveDeviceSeen', () => {
  it('creates the first row for a device', async () => {
    const { pb, devices } = fakePb([]);
    expect(await saveDeviceSeen(pb, 'u1', report, NOW)).toBe(true);
    expect(devices.create).toHaveBeenCalledWith(
      { user: 'u1', device_key: report.deviceId, platform: 'android', shell_version: '0.4.28', web_version: '0.7.34', last_seen: pbDate(NOW) },
      { requestKey: null },
    );
    expect(devices.getFullList).toHaveBeenCalledWith(expect.objectContaining({ filter: 'user = "u1"' }));
  });

  it('writes nothing when nothing changed and it is recent', async () => {
    const { pb, devices } = fakePb([row({ last_seen: pbDate(NOW - SEEN_WRITE_EVERY_MS + 1000) })]);
    expect(await saveDeviceSeen(pb, 'u1', report, NOW)).toBe(false);
    expect(devices.update).not.toHaveBeenCalled();
    expect(devices.create).not.toHaveBeenCalled();
  });

  it('writes when the last note is old enough', async () => {
    const { pb, devices } = fakePb([row({ last_seen: pbDate(NOW - SEEN_WRITE_EVERY_MS) })]);
    expect(await saveDeviceSeen(pb, 'u1', report, NOW)).toBe(true);
    expect(devices.update).toHaveBeenCalledWith('r1', expect.objectContaining({ last_seen: pbDate(NOW) }), { requestKey: null });
  });

  it('writes at once when a version changed', async () => {
    const { pb, devices } = fakePb([row()]);
    expect(await saveDeviceSeen(pb, 'u1', { ...report, webVersion: '0.7.35' }, NOW)).toBe(true);
    expect(devices.update).toHaveBeenCalledWith('r1', expect.objectContaining({ web_version: '0.7.35' }), { requestKey: null });
  });

  it('stores a missing shell version as empty', async () => {
    const { pb, devices } = fakePb([]);
    await saveDeviceSeen(pb, 'u1', { ...report, shellVersion: null, webVersion: null }, NOW);
    expect(devices.create).toHaveBeenCalledWith(expect.objectContaining({ shell_version: '', web_version: '' }), { requestKey: null });
  });

  it('keeps at most the cap, dropping the longest unseen', async () => {
    const rows = Array.from({ length: MAX_DEVICES_PER_USER }, (_, i) => row({ id: `r${i}`, device_key: `device-${i}xxx` }));
    const { pb, devices } = fakePb(rows);
    await saveDeviceSeen(pb, 'u1', report, NOW);
    expect(devices.delete.mock.calls.map((c) => (c as unknown[])[0])).toEqual([`r${MAX_DEVICES_PER_USER - 1}`]);
  });

  it('two tabs at once: the loser of the race is not an error', async () => {
    const { pb } = fakePb([], { createThrows: true, afterCreateFail: [row()] });
    expect(await saveDeviceSeen(pb, 'u1', report, NOW)).toBe(false);
  });

  it('a create that fails for another reason still fails', async () => {
    const { pb } = fakePb([], { createThrows: true });
    await expect(saveDeviceSeen(pb, 'u1', report, NOW)).rejects.toThrow('unique');
  });
});

describe('listDevices', () => {
  it('reads rows and leaves out what makes no sense', async () => {
    const { pb } = fakePb([row(), row({ id: 'r2', platform: 'toaster' }), row({ id: 'r3', shell_version: '', web_version: '<@1>' })]);
    const list = await listDevices(pb);
    expect(list.map((d) => d.id)).toEqual(['r1', 'r3']);
    expect(list[0]).toMatchObject({ userId: 'u1', platform: 'android', shellVersion: '0.4.28', webVersion: '0.7.34' });
    expect(list[1]).toMatchObject({ shellVersion: null, webVersion: null });
    expect(list[0]).not.toHaveProperty('device_key');
  });

  it('answers empty when the collection is not there yet', async () => {
    const { pb, devices } = fakePb([]);
    devices.getFullList.mockRejectedValue(new Error('404'));
    expect(await listDevices(pb)).toEqual([]);
    expect(serverLogger.warn).toHaveBeenCalled();
  });
});

describe('newestReleases', () => {
  it('asks nobody without a release token', async () => {
    update.configured = false;
    update.releases = { android: '0.4.28' };
    expect(await newestReleases()).toEqual({});
  });

  it('collects each platform, and a failing lookup is only a gap', async () => {
    update.configured = true;
    update.releases = { android: '0.4.28', windows: 'throws', ios: undefined };
    expect(await newestReleases()).toEqual({ android: '0.4.28' });
  });
});

describe('compareDevices', () => {
  const device = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    userId: 'u1',
    platform: 'android' as const,
    shellVersion: '0.4.27',
    webVersion: '0.7.34',
    lastSeen: '',
    ...over,
  });

  it('marks a shell behind the newest release and a web build behind the server', () => {
    const [d] = compareDevices([device({ webVersion: '0.7.33' })], { shells: { android: '0.4.28' }, web: '0.7.34' });
    expect(d).toMatchObject({ shellBehind: true, newestShell: '0.4.28', webBehind: true, newestWeb: '0.7.34' });
  });

  it('compares numbers, not text', () => {
    const [d] = compareDevices([device({ shellVersion: '0.4.10' })], { shells: { android: '0.4.9' }, web: '0.7.34' });
    expect(d.shellBehind).toBe(false);
  });

  it('a device on the newest is not marked', () => {
    const [d] = compareDevices([device({ shellVersion: '0.4.28' })], { shells: { android: '0.4.28' }, web: '0.7.34' });
    expect(d).toMatchObject({ shellBehind: false, webBehind: false });
  });

  it('without a release, compares with the newest seen on that platform only', () => {
    const list = compareDevices(
      [
        device(),
        device({ id: 'd2', shellVersion: '0.4.28' }),
        device({ id: 'd3', platform: 'ios', shellVersion: '0.4.24' }),
      ],
      { shells: {}, web: null },
    );
    expect(list.map((d) => d.shellBehind)).toEqual([true, false, false]);
    expect(list[0].newestShell).toBe('0.4.28');
  });

  it('a shell that cannot say is not marked', () => {
    const [d] = compareDevices([device({ shellVersion: null })], { shells: { android: '0.4.28' }, web: '0.7.34' });
    expect(d.shellBehind).toBe(false);
  });

  it('a browser has no shell to be behind', () => {
    const [d] = compareDevices([device({ platform: 'browser', shellVersion: null })], { shells: { android: '0.4.28' }, web: '0.7.34' });
    expect(d).toMatchObject({ shellBehind: false, newestShell: null });
  });

  it('a version that is not x.y.z is not compared', () => {
    const [d] = compareDevices([device({ shellVersion: '1.0' })], { shells: { android: '0.4.28' }, web: '0.7.34' });
    expect(d.shellBehind).toBe(false);
  });
});
