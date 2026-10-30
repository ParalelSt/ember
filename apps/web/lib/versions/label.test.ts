// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanShellFields, reportVersionLabel, sanitizePlatform, sanitizeVersion, versionLabel } from './label';

describe('sanitizeVersion', () => {
  it('takes the number out of a build stamp', () => {
    expect(sanitizeVersion('0.7.34 (a1b2c3d 2026-10-22)')).toBe('0.7.34');
    expect(sanitizeVersion('v0.4.28')).toBe('0.4.28');
    expect(sanitizeVersion(' 1.0 ')).toBe('1.0');
    expect(sanitizeVersion('0.4.28-beta.1')).toBe('0.4.28-beta.1');
  });

  it('turns everything else away', () => {
    for (const bad of ['', 'dev', '<@123>', '@everyone 1.0', '1.0.0<@123>', '1.2.3.4.5', 'x'.repeat(500), null, 5, {}, ['1.0.0']]) {
      expect(sanitizeVersion(bad)).toBeNull();
    }
  });

  it('never returns more than the column holds', () => {
    expect(sanitizeVersion(`${'1'.repeat(6)}.${'1'.repeat(6)}.${'1'.repeat(6)}.${'1'.repeat(6)}-${'a'.repeat(20)}`)!.length).toBeLessThanOrEqual(48);
    expect(sanitizeVersion(`${'1'.repeat(7)}.0.0`)).toBeNull();
  });
});

describe('sanitizePlatform', () => {
  it('knows the six platforms and nothing else', () => {
    expect(sanitizePlatform('android')).toBe('android');
    expect(sanitizePlatform('browser')).toBe('browser');
    expect(sanitizePlatform('Android')).toBeNull();
    expect(sanitizePlatform('toString')).toBeNull();
    expect(sanitizePlatform(undefined)).toBeNull();
  });
});

describe('versionLabel', () => {
  it('reads the way the owner wrote it', () => {
    expect(versionLabel({ name: 'Android app', shellVersion: '0.4.28', webVersion: '0.7.34' })).toBe('Android app 0.4.28, web 0.7.34');
    expect(versionLabel({ name: 'Browser', browser: true, webVersion: '0.7.34' })).toBe('Browser, web 0.7.34');
  });

  it('says so when a number is missing', () => {
    expect(versionLabel({ name: 'Android app', shellVersion: null, webVersion: '0.7.34' })).toBe('Android app (version unknown), web 0.7.34');
    expect(versionLabel({ name: 'Browser', browser: true })).toBe('Browser, web unknown');
  });
});

describe('reportVersionLabel', () => {
  it('names each platform', () => {
    const web = '0.7.34 (a1b2c3d 2026-10-22)';
    expect(reportVersionLabel({ appVersion: web, shell: 'capacitor', shellPlatform: 'android', shellVersion: '0.4.28' })).toBe('Android app 0.4.28, web 0.7.34');
    expect(reportVersionLabel({ appVersion: web, shell: 'capacitor', shellPlatform: 'ios', shellVersion: '0.4.24' })).toBe('iOS app 0.4.24, web 0.7.34');
    expect(reportVersionLabel({ appVersion: web, shell: 'tauri', shellPlatform: 'windows', shellVersion: '0.4.26' })).toBe('Windows app 0.4.26, web 0.7.34');
    expect(reportVersionLabel({ appVersion: web, shell: 'tauri', shellPlatform: 'macos', shellVersion: '0.4.26' })).toBe('macOS app 0.4.26, web 0.7.34');
    expect(reportVersionLabel({ appVersion: web, shell: 'tauri', shellPlatform: 'linux', shellVersion: '0.4.26' })).toBe('Linux app 0.4.26, web 0.7.34');
    expect(reportVersionLabel({ appVersion: web, shell: 'web', shellPlatform: 'browser', shellVersion: null })).toBe('Browser, web 0.7.34');
  });

  it('copes with a client from before shellPlatform', () => {
    expect(reportVersionLabel({ appVersion: '0.7.20', shell: 'capacitor' })).toBe('Phone app (version unknown), web 0.7.20');
    expect(reportVersionLabel({ appVersion: '0.7.20', shell: 'tauri' })).toBe('Desktop app (version unknown), web 0.7.20');
    expect(reportVersionLabel({ appVersion: '0.7.20', shell: 'web' })).toBe('Browser, web 0.7.20');
    expect(reportVersionLabel({ appVersion: '0.7.20' })).toBe('web 0.7.20');
  });

  it('a phone app too old to say its version is told apart from a browser', () => {
    expect(reportVersionLabel({ appVersion: '0.7.34', shell: 'capacitor', shellPlatform: 'android', shellVersion: null })).toBe('Android app (version unknown), web 0.7.34');
  });

  it('does not repeat what a hand-written body says', () => {
    const label = reportVersionLabel({ appVersion: '<@1> [click](http://x)', shell: '@everyone', shellPlatform: '@here', shellVersion: '```' });
    expect(label).toBe('Version unknown');
    expect(reportVersionLabel({ appVersion: '0.7.34', shellPlatform: 'android', shellVersion: '@everyone' })).toBe('Android app (version unknown), web 0.7.34');
  });

  it('says unknown when there is no context at all', () => {
    expect(reportVersionLabel(undefined)).toBe('Version unknown');
    expect(reportVersionLabel(null)).toBe('Version unknown');
    expect(reportVersionLabel('0.7.34' as never)).toBe('Version unknown');
  });
});

describe('cleanShellFields', () => {
  it('keeps good values, drops bad ones and leaves the rest alone', () => {
    expect(cleanShellFields({ route: '/x', shellVersion: 'v0.4.28', shellPlatform: 'android' })).toEqual({ route: '/x', shellVersion: '0.4.28', shellPlatform: 'android' });
    expect(cleanShellFields({ route: '/x', shellVersion: '<@1>', shellPlatform: 'toaster' })).toEqual({ route: '/x' });
  });
});
