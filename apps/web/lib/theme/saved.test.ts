import { describe, expect, it } from 'vitest';
import { copyName, docFromPreset, docFromSaved, parseSelection } from '@/lib/theme/saved';
import { PRESET_BY_ID } from '@/lib/theme/presets';

describe('parseSelection', () => {
  it('accepts exactly one of a preset or a record id', () => {
    expect(parseSelection({ preset: 'mono' })).toEqual({ preset: 'mono' });
    expect(parseSelection({ themeId: 'abcdefghij12345' })).toEqual({ themeId: 'abcdefghij12345' });
  });

  it('refuses anything else', () => {
    for (const junk of [null, 'mono', {}, { preset: 'sunset' }, { themeId: 'x' }, { themeId: '../../users' }, { preset: 'mono', themeId: 'abcdefghij12345' }]) {
      expect(parseSelection(junk)).toBeNull();
    }
  });
});

describe('docFromSaved / docFromPreset', () => {
  it('copies the colours in, so the doc stands on its own', () => {
    const inputs = PRESET_BY_ID.forest.inputs;
    expect(docFromSaved({ id: 'abcdefghij12345', name: 'Late shift', base: 'forest', inputs })).toEqual({
      v: 1,
      preset: 'forest',
      custom: inputs,
      name: 'Late shift',
      themeId: 'abcdefghij12345',
    });
    expect(docFromPreset('midnight')).toEqual({ v: 1, preset: 'midnight' });
  });
});

describe('copyName', () => {
  it('appends " copy" and stays within 40 characters', () => {
    expect(copyName('Late shift')).toBe('Late shift copy');
    const long = copyName('x'.repeat(40));
    expect(long).toHaveLength(40);
    expect(long.endsWith(' copy')).toBe(true);
    expect(copyName('   ')).toBe('Theme copy');
  });
});
