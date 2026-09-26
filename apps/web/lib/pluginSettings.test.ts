import { describe, expect, it } from 'vitest';
import { parsePluginPatch, readStoredPlugins } from './pluginSettings';

describe('parsePluginPatch', () => {
  it('accepts known keys with booleans', () => {
    expect(parsePluginPatch({ tabsEnabled: false })).toEqual({ tabsEnabled: false });
    expect(parsePluginPatch({ partyVolume: true, tabsEnabled: true })).toEqual({ partyVolume: true, tabsEnabled: true });
  });

  it('rejects unknown keys, non-booleans and empty bodies', () => {
    for (const body of [{ x: true }, { tabsEnabled: 0 }, {}, [], null, 'x', 1]) {
      expect(parsePluginPatch(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe('readStoredPlugins', () => {
  it('keeps only known boolean keys', () => {
    expect(readStoredPlugins({ partyVolume: true, tabsEnabled: 'no', x: false })).toEqual({ partyVolume: true });
    expect(readStoredPlugins(null)).toEqual({});
    expect(readStoredPlugins([true])).toEqual({});
  });
});

describe('the equalizer key', () => {
  const eq = { enabled: true, bands: [6, 0, -3, 0, 2] };

  it('a PATCH may carry it alone or beside switches', () => {
    expect(parsePluginPatch({ equalizer: eq })).toEqual({ equalizer: eq });
    expect(parsePluginPatch({ tabsEnabled: true, equalizer: eq })).toEqual({ tabsEnabled: true, equalizer: eq });
  });

  it('gains out of range are clamped, not refused', () => {
    expect(parsePluginPatch({ equalizer: { enabled: false, bands: [40, -40, 0.3, 0, 0] } })).toEqual({
      equalizer: { enabled: false, bands: [12, -12, 0.5, 0, 0] },
    });
  });

  it('refuses settings that are not settings', () => {
    for (const bad of [
      true,
      null,
      { enabled: true },
      { enabled: 'yes', bands: [0, 0, 0, 0, 0] },
      { enabled: true, bands: [0, 0, 0, 0] },
      { enabled: true, bands: [0, 0, 0, 0, 'x'] },
      { enabled: true, bands: [0, 0, 0, 0, Number.NaN] },
    ]) {
      expect(parsePluginPatch({ equalizer: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('is read back when stored, and dropped when junk', () => {
    expect(readStoredPlugins({ equalizer: eq, partyVolume: true })).toEqual({ equalizer: eq, partyVolume: true });
    expect(readStoredPlugins({ equalizer: { enabled: true, bands: [1] } })).toEqual({});
  });
});
