import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { makeTrack } from '@/test-utils/fakeBackend';

/** The browser path to the server's Discord card. The route needs a session
 *  (bughunt X3), and a 401 from api.ts sends the page to /auth, so a
 *  signed-out visitor on a public /track page must not call it at all. */

const api = vi.hoisted(() => ({ updateDiscord: vi.fn(), getPrivacy: vi.fn(), updatePrivacy: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const shell = vi.hoisted(() => ({ kind: 'web' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));

const { publishDiscordPresence } = await import('./discordPresence');

const track = makeTrack();

beforeEach(() => {
  vi.clearAllMocks();
  api.updateDiscord.mockResolvedValue({ ok: true, shared: true });
  invoke.mockResolvedValue(undefined);
  shell.kind = 'web';
  usePrivacyStore.setState({ shareDiscord: false, shareListening: false, loaded: false });
});

describe('publishDiscordPresence (web)', () => {
  it('does not call the server when signed out', () => {
    publishDiscordPresence(null, false);
    publishDiscordPresence(track, true, 5, 100);
    expect(api.updateDiscord).not.toHaveBeenCalled();
  });

  it('publishes once the account settings have loaded', () => {
    usePrivacyStore.setState({ shareDiscord: true, loaded: true });
    publishDiscordPresence(track, true, 5, 100);
    expect(api.updateDiscord).toHaveBeenCalledWith(track, true, 5, 100);
  });

  it('sends a clear when sharing is off', () => {
    usePrivacyStore.setState({ shareDiscord: false, loaded: true });
    publishDiscordPresence(track, true, 5, 100);
    expect(api.updateDiscord).toHaveBeenCalledWith(null, false, 5, 100);
  });

  it('leaves the desktop app on its local Discord', () => {
    shell.kind = 'tauri';
    publishDiscordPresence(null, false);
    expect(invoke).toHaveBeenCalledWith('discord_update', expect.objectContaining({ title: null, isPlaying: false }));
    expect(api.updateDiscord).not.toHaveBeenCalled();
  });
});
