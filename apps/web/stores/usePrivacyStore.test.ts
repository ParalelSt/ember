import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPrivacy = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { getPrivacy: () => getPrivacy(), updatePrivacy: vi.fn() },
}));

const { usePrivacyStore } = await import('./usePrivacyStore');
const initial = usePrivacyStore.getState();

beforeEach(() => {
  usePrivacyStore.setState(initial, true);
  getPrivacy.mockReset();
});

describe('usePrivacyStore.load', () => {
  it('a failed load goes back to not sharing, never keeps the last account\'s yes', async () => {
    getPrivacy.mockResolvedValueOnce({ shareDiscord: true, shareListening: true });
    await usePrivacyStore.getState().load();
    expect(usePrivacyStore.getState().shareDiscord).toBe(true);

    // Another account signs in on this device and its settings cannot load.
    getPrivacy.mockRejectedValueOnce(new Error('offline'));
    await usePrivacyStore.getState().load();
    const s = usePrivacyStore.getState();
    expect(s.shareDiscord).toBe(false);
    expect(s.shareListening).toBe(false);
  });

  it('a failed load is marked failed, not loaded, and a retry clears it', async () => {
    getPrivacy.mockRejectedValueOnce(new Error('offline'));
    await usePrivacyStore.getState().load();
    expect(usePrivacyStore.getState()).toMatchObject({ loaded: false, failed: true });

    getPrivacy.mockResolvedValueOnce({ shareDiscord: false, shareListening: true });
    await usePrivacyStore.getState().load();
    expect(usePrivacyStore.getState()).toMatchObject({ loaded: true, failed: false, shareListening: true });
  });
});
