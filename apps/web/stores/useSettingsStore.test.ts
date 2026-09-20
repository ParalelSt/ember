import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(Object.keys(stored()).sort()).toEqual(['autoReportEnabled', 'partyVolume', 'tabsEnabled']);
  });
});

describe('useSettingsStore plugin sync', () => {
  it('signed out, a toggle stays on this device and calls nothing', async () => {
    await useSettingsStore.getState().setPartyVolume(true);
    expect(useSettingsStore.getState().partyVolume).toBe(true);
    expect(updatePlugins).not.toHaveBeenCalled();
  });

  it('load applies the account values', async () => {
    getPlugins.mockResolvedValue({ partyVolume: true, tabsEnabled: false });
    await useSettingsStore.getState().loadPlugins('u1');
    expect(useSettingsStore.getState()).toMatchObject({
      partyVolume: true, tabsEnabled: false, pluginsLoaded: true, pluginsUserId: 'u1',
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
    expect(updatePlugins).toHaveBeenCalledWith({ partyVolume: true, tabsEnabled: false });
    expect(useSettingsStore.getState()).toMatchObject({ partyVolume: true, tabsEnabled: false });
  });

  it('first load migrates only the missing keys', async () => {
    useSettingsStore.setState({ tabsEnabled: false, partyVolume: true });
    getPlugins.mockResolvedValue({ tabsEnabled: true });
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
    getPlugins.mockResolvedValue({ partyVolume: true, tabsEnabled: false });
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
