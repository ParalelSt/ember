// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decideUpdate,
  installAssetPattern,
  isPaused,
  minVersionFor,
  parseMarkers,
  plainNotes,
  platformOfTarget,
  type InstallKind,
  type Platform,
  type PolicyRelease,
} from './updatePolicy';

// What every native shell's launch gate is told. Pure: the release, the
// shell, the host's env in, the answer out.

function release(tag = 'v0.4.22', body = 'Fixes and polish.'): PolicyRelease {
  const v = tag;
  const names = [
    `Ember-${v}-macos-arm64.app.tar.gz`,
    `Ember-${v}-macos-arm64.dmg`,
    `Ember-${v}-windows-x64-setup.exe`,
    `Ember-${v}-windows-x64.msi`,
    `Ember-${v}-linux-x86_64.AppImage`,
    `Ember-${v}-linux-amd64.deb`,
    `Ember-${v}-linux-x86_64.rpm`,
    `Ember-${v}-android.apk`,
  ];
  const assets = names.flatMap((name, i) => [
    { id: 100 + i * 2, name, size: 1000 + i },
    ...(name.endsWith('.dmg') || name.endsWith('.apk') ? [] : [{ id: 101 + i * 2, name: `${name}.sig`, size: 10 }]),
  ]);
  return { tag_name: tag, name: `Ember ${tag}`, body, assets };
}

const NO_ENV = {};

function decide(platform: Platform, install: InstallKind | null, current = '0.4.21', extra: Partial<Parameters<typeof decideUpdate>[0]> = {}) {
  return decideUpdate({ release: release(), platform, install, arch: 'x86_64', current, env: NO_ENV, origin: 'https://ember.test', ...extra });
}

describe('decideUpdate: who gets which update', () => {
  const installable: Array<[Platform, InstallKind | null]> = [
    ['windows', 'nsis'],
    ['windows', 'msi'],
    ['windows', null],
    ['macos', 'app'],
    ['linux', 'appimage'],
    ['linux', 'deb'],
    ['linux', 'rpm'],
    ['linux', null],
    ['android', 'apk'],
  ];
  for (const [platform, install] of installable) {
    it(`offers ${platform}/${install ?? 'default'} an install of the newer release`, () => {
      const a = decide(platform, install);
      expect(a.latest).toBe('0.4.22');
      expect(a.update).toMatchObject({ version: '0.4.22', action: 'install', mandatory: false, reason: null });
      // A .deb or .rpm gets the download page as its fallback; nothing else
      // needs one.
      if (install === 'deb' || install === 'rpm') expect(a.update!.url).toMatch(/^https:\/\/ember\.test\/api\/desktop\/asset\/\d+$/);
      else expect(a.update!.url).toBeNull();
      expect(a.update!.size).toBeGreaterThan(0);
    });
  }

  it('says nothing to a shell on the latest version, or a newer one', () => {
    expect(decide('windows', 'nsis', '0.4.22').update).toBeNull();
    expect(decide('android', 'apk', '0.5.0').update).toBeNull();
  });

  it('never offers iOS or the web anything (no TestFlight, the web is always current)', () => {
    expect(decide('ios', 'testflight').update).toBeNull();
    expect(decide('web', null).update).toBeNull();
  });

  it('a desktop bundle without its signature is not installable', () => {
    const r = release();
    r.assets = r.assets!.filter((a) => a.name !== 'Ember-v0.4.22-windows-x64-setup.exe.sig');
    const errors: string[] = [];
    expect(decide('windows', 'nsis', '0.4.21', { release: r, errors }).update).toBeNull();
    expect(errors.join()).toMatch(/nothing windows\/nsis can install/);
  });

  it('a .deb with no signature becomes a notice that downloads it through the server', () => {
    const r = release();
    r.assets = r.assets!.filter((a) => a.name !== 'Ember-v0.4.22-linux-amd64.deb.sig');
    const a = decide('linux', 'deb', '0.4.21', { release: r });
    expect(a.update).toMatchObject({ action: 'download-page' });
    const deb = r.assets!.find((x) => x.name.endsWith('.deb'))!;
    expect(a.update!.url).toBe(`https://ember.test/api/desktop/asset/${deb.id}`);
  });

  it('LINUX_DOWNLOAD_URL is the notice\'s page when the host sets one', () => {
    const r = release();
    r.assets = r.assets!.filter((a) => !a.name.endsWith('.rpm.sig'));
    const a = decide('linux', 'rpm', '0.4.21', { release: r, env: { LINUX_DOWNLOAD_URL: 'https://example.test/ember' } });
    expect(a.update).toMatchObject({ action: 'download-page', url: 'https://example.test/ember' });
  });

  it('windows on arm gets the arm64 setup', () => {
    const r = release();
    r.assets!.push({ id: 900, name: 'Ember-v0.4.22-windows-arm64-setup.exe', size: 5 }, { id: 901, name: 'Ember-v0.4.22-windows-arm64-setup.exe.sig', size: 1 });
    expect(decide('windows', 'nsis', '0.4.21', { release: r, arch: 'aarch64' }).update?.size).toBe(5);
  });

  it('no release (GitHub down, no token) is "unavailable", not an error', () => {
    const a = decide('windows', 'nsis', '0.4.21', { release: null });
    expect(a).toMatchObject({ update: null, unavailable: true, latest: null });
  });
});

describe('mandatory updates and minimum versions', () => {
  it('a release flagged mandatory is mandatory for every older shell', () => {
    const a = decide('macos', 'app', '0.4.21', { release: release('v0.4.22', 'Important fix.\n\nmandatory: true') });
    expect(a.update).toMatchObject({ mandatory: true, reason: 'flagged' });
  });

  it('a shell below minVersion must update, one at or above it may wait', () => {
    const r = release('v0.4.22', 'Fixes.\nminVersion: 0.4.20');
    expect(decide('windows', 'nsis', '0.4.19', { release: r }).update).toMatchObject({ mandatory: true, reason: 'min-version' });
    expect(decide('windows', 'nsis', '0.4.20', { release: r }).update).toMatchObject({ mandatory: false, reason: null });
    expect(decide('windows', 'nsis', '0.4.20', { release: r }).minVersion).toBe('0.4.20');
  });

  it('a per-platform minVersion wins over the general one', () => {
    const r = release('v0.4.22', 'minVersion: 0.4.10\nminVersion.android: 0.4.21');
    expect(decide('android', 'apk', '0.4.20', { release: r }).update?.mandatory).toBe(true);
    expect(decide('windows', 'nsis', '0.4.20', { release: r }).update?.mandatory).toBe(false);
  });

  it('EMBER_MIN_VERSION_<PLATFORM> on the host wins over the release', () => {
    const a = decide('linux', 'appimage', '0.4.20', { env: { EMBER_MIN_VERSION_LINUX: '0.4.21' } });
    expect(a.update).toMatchObject({ mandatory: true, reason: 'min-version' });
  });

  it('a minVersion above the release itself is ignored and reported', () => {
    const errors: string[] = [];
    const a = decide('windows', 'nsis', '0.4.21', { release: release('v0.4.22', 'minVersion: 0.9.0'), errors });
    expect(a.update?.mandatory).toBe(false);
    expect(a.minVersion).toBeNull();
    expect(errors[0]).toMatch(/above the latest release/);
  });

  it('mandatory never applies to a shell that is already current', () => {
    expect(decide('windows', 'nsis', '0.4.22', { release: release('v0.4.22', 'mandatory: true') }).update).toBeNull();
  });
});

describe('pausing', () => {
  it('EMBER_UPDATES_PAUSED=all pauses everyone', () => {
    const a = decide('windows', 'nsis', '0.4.21', { env: { EMBER_UPDATES_PAUSED: 'all' } });
    expect(a).toMatchObject({ update: null, paused: true });
  });

  it('a list pauses only the platforms on it', () => {
    const env = { EMBER_UPDATES_PAUSED: 'windows, android' };
    expect(isPaused('windows', env)).toBe(true);
    expect(isPaused('android', env)).toBe(true);
    expect(isPaused('macos', env)).toBe(false);
    expect(isPaused('linux', {})).toBe(false);
  });
});

describe('markers and notes', () => {
  it('reads the markers in any case, with : or =', () => {
    expect(parseMarkers('MANDATORY = yes\nminversion: v0.4.3\nminVersion.Windows=0.4.5')).toEqual({
      mandatory: true,
      minVersion: '0.4.3',
      minVersionFor: { windows: '0.4.5' },
    });
    expect(parseMarkers('This is not mandatory: true, just prose.').mandatory).toBe(false);
    expect(parseMarkers(undefined)).toEqual({ mandatory: false, minVersion: null, minVersionFor: {} });
  });

  it('strips markers and Markdown from the notes and keeps them short', () => {
    const notes = plainNotes({ tag_name: 'v0.4.22', body: '## What changed\n\n**Faster** start.\n\nmandatory: true\nminVersion: 0.4.20\nversionCode: 28' });
    expect(notes).toBe('What changed\nFaster start.');
    const long = plainNotes({ tag_name: 'v1.0.0', body: 'x'.repeat(1000) });
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('...')).toBe(true);
    expect(plainNotes({ tag_name: 'v1.0.0', body: 'mandatory: true', name: 'Ember v1.0.0' })).toBe('Ember v1.0.0');
  });

  it('minVersionFor returns null when nothing sets one', () => {
    expect(minVersionFor('windows', parseMarkers(''), '0.4.22', {})).toBeNull();
  });
});

describe('asset patterns', () => {
  it('maps updater targets to platforms', () => {
    expect(platformOfTarget('darwin-aarch64')).toBe('macos');
    expect(platformOfTarget('windows')).toBe('windows');
    expect(platformOfTarget('linux-x86_64')).toBe('linux');
    expect(platformOfTarget('plan9')).toBeNull();
  });

  it('each install kind updates from its own kind of file', () => {
    expect(installAssetPattern('windows', 'msi', 'x86_64')!.test('Ember-v1.0.0-windows-x64.msi')).toBe(true);
    expect(installAssetPattern('windows', 'nsis', 'x86_64')!.test('Ember-v1.0.0-windows-x64.msi')).toBe(false);
    expect(installAssetPattern('linux', 'deb', null)!.test('Ember-v1.0.0-linux-amd64.deb')).toBe(true);
    expect(installAssetPattern('linux', 'rpm', null)!.test('Ember-v1.0.0-linux-x86_64.rpm')).toBe(true);
    expect(installAssetPattern('linux', null, null)!.test('Ember-v1.0.0-linux-x86_64.AppImage')).toBe(true);
    expect(installAssetPattern('ios', 'testflight', null)).toBeNull();
  });
});
