import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './useSettingsStore';

// tabsEnabled: on by default (nobody using tabs today loses them on
// update), and the setter persists like partyVolume does.

const initial = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initial, true);
  window.localStorage.clear();
});

describe('useSettingsStore tabsEnabled', () => {
  it('defaults to true', () => {
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
  });

  it('setTabsEnabled flips the state', () => {
    useSettingsStore.getState().setTabsEnabled(false);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    useSettingsStore.getState().setTabsEnabled(true);
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
  });

  it('persists the choice to storage like partyVolume', () => {
    useSettingsStore.getState().setTabsEnabled(false);
    const raw = window.localStorage.getItem('ember.settings.v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.tabsEnabled).toBe(false);
  });
});
