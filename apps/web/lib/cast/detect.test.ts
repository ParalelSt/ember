import { describe, expect, it } from 'vitest';
import { castPath, type CastEnv } from './detect';

const env = (over: Partial<CastEnv>): CastEnv => ({ shell: 'web', androidCast: false, chrome: false, airplay: false, secure: true, ...over });

describe('castPath', () => {
  it('Chrome casts with Google Cast', () => {
    expect(castPath(env({ chrome: true }))).toBe('google');
  });
  it('Safari uses AirPlay', () => {
    expect(castPath(env({ airplay: true }))).toBe('airplay');
  });
  it('Firefox and other browsers: no button', () => {
    expect(castPath(env({}))).toBeNull();
  });
  it('an insecure page (plain http on a LAN address) cannot cast', () => {
    expect(castPath(env({ chrome: true, secure: false }))).toBeNull();
  });
  it('the desktop app never casts, even though its webview may look like Chrome', () => {
    expect(castPath(env({ shell: 'tauri', chrome: true }))).toBeNull();
    expect(castPath(env({ shell: 'tauri', airplay: true }))).toBeNull();
  });
  it('the Android app casts natively, when its build can', () => {
    expect(castPath(env({ shell: 'capacitor', androidCast: true, chrome: true }))).toBe('android');
    expect(castPath(env({ shell: 'capacitor', androidCast: false, chrome: true }))).toBeNull();
  });
});
