import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPlugins = vi.fn();
const updatePlugins = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    getPlugins: () => getPlugins(),
    updatePlugins: (patch: unknown) => updatePlugins(patch),
  },
}));

const { useSettingsStore } = await import('./useSettingsStore');

// tabsEnabled: on by default (nobody using tabs today loses them on
// update), and the setter persists like partyVolume does.

const initial = useSettingsStore.getState();
const stored = () => JSON.parse(window.localStorage.getItem('ember.settings.v1') ?? '{}').state;

beforeEach(() => {
  useSettingsStore.setState(initial, true);
  window.localStorage.clear();
  getPlugins.mockReset();
  updatePlugins.mockReset();
  updatePlugins.mockImplementation(async (patch: unknown) => patch);
});

describe('useSettingsStore tabsEnabled', () => {
  it('defaults to true', () => {
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
  });

  it('setTabsEnabled flips the state', () => {
    void useSettingsStore.getState().setTabsEnabled(false);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    void useSettingsStore.getState().setTabsEnabled(true);
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
  });

  it('persists the choice to storage like partyVolume', () => {
    void useSettingsStore.getState().setTabsEnabled(false);
    expect(stored().tabsEnabled).toBe(false);
  });

  it('persists only the values, never the sync state', async () => {
    getPlugins.mockResolvedValue({ partyVolume: false, tabsEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(Object.keys(stored()).sort()).toEqual([
      'autoCacheEnabled', 'autoCacheOnMetered', 'autoReportEnabled', 'equalizer', 'normalizeVolume', 'partyVolume',
      'tabsEnabled',
    ]);
  });
});

describe('useSettingsStore normalizeVolume', () => {
  it('is on by default', () => {
    expect(useSettingsStore.getState().normalizeVolume).toBe(true);
  });

  it('persists and follows the account like the other plugin switches', async () => {
    useSettingsStore.setState({ pluginsUserId: 'u1' });
    await useSettingsStore.getState().setNormalizeVolume(false);
    expect(useSettingsStore.getState().normalizeVolume).toBe(false);
    expect(stored().normalizeVolume).toBe(false);
    expect(updatePlugins).toHaveBeenCalledWith({ normalizeVolume: false });
  });
});

describe('useSettingsStore auto cache switches', () => {
  it('cache upcoming songs is on by default, mobile data off', () => {
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(true);
    expect(useSettingsStore.getState().autoCacheOnMetered).toBe(false);
  });

  it('both persist on this device', () => {
    useSettingsStore.getState().setAutoCacheEnabled(false);
    useSettingsStore.getState().setAutoCacheOnMetered(true);
    expect(stored()).toMatchObject({ autoCacheEnabled: false, autoCacheOnMetered: true });
  });

  it('never follow the account: an account load leaves them alone and saves nothing for them', async () => {
    useSettingsStore.getState().setAutoCacheEnabled(false);
    getPlugins.mockResolvedValue({ partyVolume: true, tabsEnabled: true, autoCacheEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(false);
    for (const [patch] of updatePlugins.mock.calls) {
      expect(patch).not.toHaveProperty('autoCacheEnabled');
      expect(patch).not.toHaveProperty('autoCacheOnMetered');
    }
  });
});

describe('useSettingsStore plugin sync', () => {
  it('signed out, a toggle stays on this device and calls nothing', async () => {
    await useSettingsStore.getState().setPartyVolume(true);
    expect(useSettingsStore.getState().partyVolume).toBe(true);
    expect(updatePlugins).not.toHaveBeenCalled();
  });

  it('load applies the account values', async () => {
    getPlugins.mockResolvedValue({ partyVolume: true, tabsEnabled: false, normalizeVolume: false });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState()).toMatchObject({
      partyVolume: true, tabsEnabled: false, normalizeVolume: false, pluginsLoaded: true, pluginsUserId: 'u1',
    });
    expect(updatePlugins).not.toHaveBeenCalled();
  });

  it('the account value wins over a stale local cache, and refreshes the cache', async () => {
    useSettingsStore.setState({ tabsEnabled: false, partyVolume: true });
    getPlugins.mockResolvedValue({ partyVolume: false, tabsEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState()).toMatchObject({ partyVolume: false, tabsEnabled: true });
    expect(stored()).toMatchObject({ partyVolume: false, tabsEnabled: true });
  });

  it('first load: keys the account never stored are written up from this device', async () => {
    useSettingsStore.setState({ tabsEnabled: false, partyVolume: true });
    getPlugins.mockResolvedValue({});
    await useSettingsStore.getState().loadPlugins('u1');
    expect(updatePlugins).toHaveBeenCalledWith({ partyVolume: true, tabsEnabled: false, normalizeVolume: true });
    expect(useSettingsStore.getState()).toMatchObject({ partyVolume: true, tabsEnabled: false });
  });

  it('first load migrates only the missing keys', async () => {
    useSettingsStore.setState({ tabsEnabled: false, partyVolume: true });
    getPlugins.mockResolvedValue({ tabsEnabled: true, normalizeVolume: true });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(updatePlugins).toHaveBeenCalledWith({ partyVolume: true });
    expect(useSettingsStore.getState()).toMatchObject({ partyVolume: true, tabsEnabled: true });
  });

  it('a failed migration write keeps the local values', async () => {
    useSettingsStore.setState({ partyVolume: true });
    getPlugins.mockResolvedValue({});
    updatePlugins.mockRejectedValue(new Error('offline'));
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState().partyVolume).toBe(true);
  });

  it('loads once per user id', async () => {
    getPlugins.mockResolvedValue({ partyVolume: false, tabsEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    await useSettingsStore.getState().loadPlugins('u1');
    expect(getPlugins).toHaveBeenCalledTimes(1);
    await useSettingsStore.getState().loadPlugins('u2');
    expect(getPlugins).toHaveBeenCalledTimes(2);
  });

  it('a failed load keeps the cached values', async () => {
    useSettingsStore.setState({ tabsEnabled: false });
    getPlugins.mockRejectedValue(new Error('offline'));
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState()).toMatchObject({ tabsEnabled: false, pluginsLoaded: false });
    expect(updatePlugins).not.toHaveBeenCalled();
  });

  it('signed in, a toggle is optimistic and saved to the account', async () => {
    getPlugins.mockResolvedValue({ partyVolume: false, tabsEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    let resolve!: (v: unknown) => void;
    updatePlugins.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const saving = useSettingsStore.getState().setTabsEnabled(false);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    expect(updatePlugins).toHaveBeenCalledWith({ tabsEnabled: false });
    resolve({ partyVolume: false, tabsEnabled: false });
    await saving;
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
  });

  it('rolls back when the save fails', async () => {
    getPlugins.mockResolvedValue({ partyVolume: false, tabsEnabled: true });
    await useSettingsStore.getState().loadPlugins('u1');
    updatePlugins.mockRejectedValue(new Error('offline'));
    await useSettingsStore.getState().setPartyVolume(true);
    expect(useSettingsStore.getState().partyVolume).toBe(false);
    expect(stored().partyVolume).toBe(false);
  });

  it('a toggle made while the load is in flight is not overwritten by it', async () => {
    let resolve!: (v: unknown) => void;
    getPlugins.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const loading = useSettingsStore.getState().loadPlugins('u1');
    await useSettingsStore.getState().setTabsEnabled(false);
    resolve({ partyVolume: true, tabsEnabled: true });
    await loading;
    expect(useSettingsStore.getState()).toMatchObject({ tabsEnabled: false, partyVolume: true });
  });

  it('sign-out stops syncing and keeps the values as the local fallback', async () => {
    getPlugins.mockResolvedValue({ partyVolume: true, tabsEnabled: false, normalizeVolume: true });
    await useSettingsStore.getState().loadPlugins('u1');
    useSettingsStore.getState().resetPluginSync();
    expect(useSettingsStore.getState()).toMatchObject({
      pluginsUserId: null, pluginsLoaded: false, partyVolume: true, tabsEnabled: false,
    });
    await useSettingsStore.getState().setTabsEnabled(true);
    expect(updatePlugins).not.toHaveBeenCalled();
    // Signing back in loads again.
    await useSettingsStore.getState().loadPlugins('u1');
    expect(getPlugins).toHaveBeenCalledTimes(2);
  });
});

describe('useSettingsStore equalizer', () => {
  const bass = { enabled: true, bands: [7, 4, 0, 0, 0] };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is off and flat by default', () => {
    expect(useSettingsStore.getState().equalizer).toEqual({ enabled: false, bands: [0, 0, 0, 0, 0] });
  });

  it('applies at once, clamped, and persists on this device', () => {
    useSettingsStore.getState().setEqualizer({ enabled: true, bands: [30, 0, 0, 0, -1.2] });
    expect(useSettingsStore.getState().equalizer).toEqual({ enabled: true, bands: [12, 0, 0, 0, -1] });
    expect(stored().equalizer).toEqual({ enabled: true, bands: [12, 0, 0, 0, -1] });
  });

  it('ignores settings that are not settings', () => {
    useSettingsStore.getState().setEqualizer({ enabled: true, bands: [1, 2] });
    expect(useSettingsStore.getState().equalizer.bands).toEqual([0, 0, 0, 0, 0]);
  });

  it('signed out, it stays on this device and calls nothing', () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setEqualizer(bass);
    vi.advanceTimersByTime(5000);
    expect(updatePlugins).not.toHaveBeenCalled();
  });

  it('signed in, a drag of changes saves once, the last value, after a pause', async () => {
    getPlugins.mockResolvedValue({});
    await useSettingsStore.getState().loadPlugins('u1');
    updatePlugins.mockClear();
    vi.useFakeTimers();
    for (const g of [1, 2, 3, 4]) useSettingsStore.getState().setEqualizer({ enabled: true, bands: [g, 0, 0, 0, 0] });
    expect(updatePlugins).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(updatePlugins).toHaveBeenCalledTimes(1);
    expect(updatePlugins).toHaveBeenCalledWith({ equalizer: { enabled: true, bands: [4, 0, 0, 0, 0] } });
  });

  it('a failed save keeps the local value', async () => {
    getPlugins.mockResolvedValue({});
    await useSettingsStore.getState().loadPlugins('u1');
    updatePlugins.mockRejectedValue(new Error('offline'));
    vi.useFakeTimers();
    useSettingsStore.getState().setEqualizer(bass);
    await vi.advanceTimersByTimeAsync(600);
    expect(useSettingsStore.getState().equalizer).toEqual(bass);
  });

  it('the account value wins on load', async () => {
    useSettingsStore.setState({ equalizer: { enabled: false, bands: [0, 0, 0, 0, 3] } });
    getPlugins.mockResolvedValue({ equalizer: bass });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState().equalizer).toEqual(bass);
    expect(updatePlugins.mock.calls.some(([patch]) => 'equalizer' in (patch as object))).toBe(false);
  });

  it('first load writes a changed device equalizer up, but never an untouched default', async () => {
    getPlugins.mockResolvedValue({});
    await useSettingsStore.getState().loadPlugins('u1');
    expect(updatePlugins).toHaveBeenCalledWith({ partyVolume: false, tabsEnabled: true, normalizeVolume: true });

    useSettingsStore.setState(initial, true);
    updatePlugins.mockClear();
    useSettingsStore.setState({ equalizer: bass });
    await useSettingsStore.getState().loadPlugins('u2');
    expect(updatePlugins).toHaveBeenCalledWith({
      partyVolume: false, tabsEnabled: true, normalizeVolume: true, equalizer: bass,
    });
  });

  it('a change made while the load is in flight is not overwritten by it', async () => {
    let resolve!: (v: unknown) => void;
    getPlugins.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const loading = useSettingsStore.getState().loadPlugins('u1');
    useSettingsStore.getState().setEqualizer(bass);
    resolve({ equalizer: { enabled: false, bands: [0, 0, 0, 0, 0] } });
    await loading;
    expect(useSettingsStore.getState().equalizer).toEqual(bass);
  });

  it('a stored value that is not settings falls back to the default', async () => {
    window.localStorage.setItem('ember.settings.v1', JSON.stringify({ state: { equalizer: { enabled: true } }, version: 0 }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().equalizer).toEqual({ enabled: false, bands: [0, 0, 0, 0, 0] });
  });
});
