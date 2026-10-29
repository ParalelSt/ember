// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-platform releases: each shell has its own tag (windows-v0.4.26,
// android-v0.4.25, ...), and the bare v0.4.x tags from before stay
// everyone's. Which release a platform sees, and which files the asset
// proxies may fetch with the host's token.

vi.stubEnv('GITHUB_RELEASES_TOKEN', 'test-token');
vi.stubEnv('GITHUB_API_BASE', 'http://github.test');
vi.stubEnv('GITHUB_RELEASES_REPO', 'owner/ember');
vi.stubEnv('UPDATE_CACHE_MS', '0');
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

type Rel = { tag_name: string; draft?: boolean; prerelease?: boolean; assets?: { id: number; name: string; size: number }[] };

const rel = (tag_name: string, extra: Partial<Rel> = {}): Rel => ({ tag_name, draft: false, prerelease: false, assets: [], ...extra });

const feed = { releases: [] as Rel[] };
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async () => Response.json(feed.releases)) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const lib = await import('./desktopUpdate');
const { androidApkAsset } = await import('./androidUpdate');

beforeEach(() => {
  lib._resetReleaseCache();
  feed.releases = [];
});

describe('parseReleaseTag', () => {
  it('reads a platform tag and a legacy bare tag', () => {
    expect(lib.parseReleaseTag('windows-v0.4.26')).toEqual({ platform: 'windows', version: '0.4.26' });
    expect(lib.parseReleaseTag('android-v0.4.25')).toEqual({ platform: 'android', version: '0.4.25' });
    expect(lib.parseReleaseTag('v0.4.25')).toEqual({ platform: null, version: '0.4.25' });
  });

  it('refuses anything else', () => {
    for (const tag of ['0.4.25', 'v0.4', 'v0.5.1-rc1', 'web-v0.7.31', 'notified/main', 'windows-0.4.26', 'Windows-v0.4.26', '']) {
      expect(lib.parseReleaseTag(tag), tag).toBeNull();
    }
  });
});

describe('pickRelease', () => {
  it('takes a platform its own release over an older legacy one', () => {
    const list = [rel('windows-v0.4.26'), rel('v0.4.25')] as never[];
    expect(lib.pickRelease(list, 'windows')?.tag_name).toBe('windows-v0.4.26');
    expect(lib.pickRelease(list, 'macos')?.tag_name).toBe('v0.4.25');
  });

  it('a newer legacy release beats an older platform one', () => {
    const list = [rel('windows-v0.4.20'), rel('v0.4.25')] as never[];
    expect(lib.pickRelease(list, 'windows')?.tag_name).toBe('v0.4.25');
  });

  it('on the same version the platform tag wins, whatever the order', () => {
    expect(lib.pickRelease([rel('v0.4.25'), rel('linux-v0.4.25')] as never[], 'linux')?.tag_name).toBe('linux-v0.4.25');
    expect(lib.pickRelease([rel('linux-v0.4.25'), rel('v0.4.25')] as never[], 'linux')?.tag_name).toBe('linux-v0.4.25');
  });

  it('skips drafts, pre-releases and tags it cannot read', () => {
    const list = [
      rel('windows-v0.5.0', { draft: true }),
      rel('windows-v0.4.30', { prerelease: true }),
      rel('v0.6.0-rc1'),
      rel('windows-v0.4.26'),
    ] as never[];
    expect(lib.pickRelease(list, 'windows')?.tag_name).toBe('windows-v0.4.26');
  });

  it('a platform never sees another platform release', () => {
    const list = [rel('android-v0.4.30'), rel('ios-v0.4.29'), rel('macos-v0.4.28')] as never[];
    expect(lib.pickRelease(list, 'windows')).toBeNull();
    expect(lib.pickRelease(list, 'linux')).toBeNull();
    expect(lib.pickRelease(list, 'android')?.tag_name).toBe('android-v0.4.30');
    expect(lib.pickRelease(list, 'macos')?.tag_name).toBe('macos-v0.4.28');
  });

  it('compares versions as numbers, not text', () => {
    expect(lib.pickRelease([rel('v0.4.9'), rel('v0.4.25'), rel('v0.4.100')] as never[], 'android')?.tag_name).toBe('v0.4.100');
  });

  it('releaseVersion drops the platform and the v', () => {
    expect(lib.releaseVersion({ tag_name: 'macos-v0.4.26' })).toBe('0.4.26');
    expect(lib.releaseVersion({ tag_name: 'v0.4.25' })).toBe('0.4.25');
  });
});

describe('asset proxies serve current releases only', () => {
  beforeEach(() => {
    feed.releases = [
      rel('windows-v0.4.26', {
        assets: [
          { id: 11, name: 'Ember-v0.4.26-windows-x64-setup.exe', size: 1 },
          { id: 12, name: 'Ember-v0.4.26-windows-x64-setup.exe.sig', size: 1 },
        ],
      }),
      rel('android-v0.4.26', { assets: [{ id: 21, name: 'Ember-v0.4.26-android.apk', size: 1 }] }),
      rel('v0.4.25', {
        assets: [
          { id: 31, name: 'Ember-v0.4.25-windows-x64-setup.exe', size: 1 },
          { id: 32, name: 'Ember-v0.4.25-macos-arm64.app.tar.gz', size: 1 },
          { id: 33, name: 'Ember-v0.4.25-macos-arm64.dmg', size: 1 },
          { id: 34, name: 'Ember-v0.4.25-android.apk', size: 1 },
        ],
      }),
      rel('windows-v0.4.27', { draft: true, assets: [{ id: 41, name: 'Ember-v0.4.27-windows-x64-setup.exe', size: 1 }] }),
      rel('v0.4.20', { assets: [{ id: 51, name: 'Ember-v0.4.20-macos-arm64.app.tar.gz', size: 1 }] }),
    ];
  });

  it('the updater files of every desktop platform current release', async () => {
    expect((await lib.updaterAsset(11))?.id).toBe(11);
    expect((await lib.updaterAsset(12))?.id).toBe(12);
    // macOS is still on the legacy release, so its bundle is current.
    expect((await lib.updaterAsset(32))?.id).toBe(32);
  });

  it('never a release no platform is on, a draft, a hand-download file or an APK', async () => {
    expect(await lib.updaterAsset(51)).toBeNull();
    expect(await lib.updaterAsset(41)).toBeNull();
    expect(await lib.updaterAsset(21)).toBeNull();
    expect(await lib.updaterAsset(33)).toBeNull();
    expect(await lib.updaterAsset(999)).toBeNull();
  });

  it('the APK proxy serves the current Android APK only', async () => {
    expect((await androidApkAsset(21))?.id).toBe(21);
    // v0.4.25 is still current for the desktop, but Android moved past it.
    expect(await androidApkAsset(34)).toBeNull();
    expect(await androidApkAsset(11)).toBeNull();
  });
});
