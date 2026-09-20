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
