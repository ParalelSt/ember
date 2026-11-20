import { afterEach, describe, expect, it, vi } from 'vitest';
import { androidOwnsDiscord, setAndroidDiscordSharing } from './androidDiscord';

function shell(platform: 'android' | 'ios' | null, plugin?: unknown) {
  (window as unknown as { Capacitor?: unknown }).Capacitor =
    platform === null
      ? undefined
      : {
          isNativePlatform: () => true,
          getPlatform: () => platform,
          Plugins: plugin === undefined ? {} : { EmberDiscord: plugin },
        };
}

afterEach(() => shell(null));

describe('setAndroidDiscordSharing', () => {
  it('tells the Android app', () => {
    const setSharing = vi.fn(() => Promise.resolve());
    shell('android', { setSharing });
    setAndroidDiscordSharing(true);
    expect(setSharing).toHaveBeenCalledWith({ enabled: true });
    expect(androidOwnsDiscord()).toBe(true);
  });

  it('tells nothing to the iPhone app or a browser', () => {
    const setSharing = vi.fn(() => Promise.resolve());
    shell('ios', { setSharing });
    setAndroidDiscordSharing(true);
    expect(androidOwnsDiscord()).toBe(false);
    shell(null);
    setAndroidDiscordSharing(true);
    expect(androidOwnsDiscord()).toBe(false);
    expect(setSharing).not.toHaveBeenCalled();
  });

  it('is quiet in an Android app from before the plugin', () => {
    shell('android');
    expect(() => setAndroidDiscordSharing(true)).not.toThrow();
  });

  it('is quiet when the app refuses', async () => {
    shell('android', { setSharing: () => Promise.reject(new Error('no')) });
    expect(() => setAndroidDiscordSharing(false)).not.toThrow();
    await Promise.resolve();
  });

  it('is quiet when the bridge throws', () => {
    shell('android', {
      setSharing: () => {
        throw new Error('bridge');
      },
    });
    expect(() => setAndroidDiscordSharing(false)).not.toThrow();
  });
});
