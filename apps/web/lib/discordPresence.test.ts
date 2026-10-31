import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishDiscordPresence } from './discordPresence';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { makeTrack } from '@/test-utils/fakeBackend';

const m = vi.hoisted(() => ({
  updateDiscord: vi.fn(() => Promise.resolve({ ok: true, shared: true })),
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/api', () => ({ api: { updateDiscord: m.updateDiscord } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));

function capacitor(platform: 'android' | 'ios' | null) {
  (window as unknown as { Capacitor?: unknown }).Capacitor =
    platform === null ? undefined : { isNativePlatform: () => true, getPlatform: () => platform, Plugins: {} };
}

const song = makeTrack();

beforeEach(() => {
  vi.clearAllMocks();
  usePrivacyStore.setState({ shareDiscord: true, loaded: true });
});
afterEach(() => capacitor(null));

describe('publishDiscordPresence', () => {
  it('never reaches the host route from the Android app: the route sets the HOST\'s Discord', () => {
    capacitor('android');
    publishDiscordPresence(song, true, 10, 200);
    publishDiscordPresence(song, false, 10, 200);
    usePrivacyStore.setState({ shareDiscord: false });
    publishDiscordPresence(song, true, 10, 200);
    expect(m.updateDiscord).not.toHaveBeenCalled();
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('stays on the route in the iPhone app', () => {
    capacitor('ios');
    publishDiscordPresence(song, true, 10, 200);
    expect(m.updateDiscord).toHaveBeenCalledWith(song, true, 10, 200);
  });

  it('stays on the route in a browser, and a switched-off one publishes a clear', () => {
    publishDiscordPresence(song, true, 10, 200);
    expect(m.updateDiscord).toHaveBeenLastCalledWith(song, true, 10, 200);
    usePrivacyStore.setState({ shareDiscord: false });
    publishDiscordPresence(song, true, 10, 200);
    expect(m.updateDiscord).toHaveBeenLastCalledWith(null, false, 10, 200);
  });
});
