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

describe('usePrivacyStore, a load and a switch at once', () => {
  it('a load that left before the switch was saved does not put the old value back', async () => {
    const { api } = await import('@/lib/api');
    let answerLoad: (v: { shareDiscord: boolean; shareListening: boolean }) => void = () => {};
    getPrivacy.mockReturnValueOnce(new Promise((r) => { answerLoad = r; }));
    vi.mocked(api.updatePrivacy).mockResolvedValueOnce({ shareDiscord: true, shareListening: false });
    usePrivacyStore.setState({ loaded: true });

    // A reload is on its way (the profile was just saved), and the member
    // turns Discord on meanwhile.
    const loading = usePrivacyStore.getState().load();
    await usePrivacyStore.getState().set({ shareDiscord: true });
    expect(usePrivacyStore.getState().shareDiscord).toBe(true);

    // The read, made before the switch was saved, lands last.
    answerLoad({ shareDiscord: false, shareListening: false });
    await loading;
    expect(usePrivacyStore.getState().shareDiscord).toBe(true);
  });

  it('a load that fails after the switch was saved does not turn it back off', async () => {
    const { api } = await import('@/lib/api');
    let failLoad: (e: Error) => void = () => {};
    getPrivacy.mockReturnValueOnce(new Promise((_r, j) => { failLoad = j; }));
    vi.mocked(api.updatePrivacy).mockResolvedValueOnce({ shareDiscord: false, shareListening: true });
    usePrivacyStore.setState({ loaded: true });

    const loading = usePrivacyStore.getState().load();
    await usePrivacyStore.getState().set({ shareListening: true });
    failLoad(new Error('offline'));
    await loading;
    expect(usePrivacyStore.getState()).toMatchObject({ shareListening: true, loaded: true, failed: false });
  });
});
