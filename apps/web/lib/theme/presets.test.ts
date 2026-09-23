import { describe, expect, it } from 'vitest';
import { checkTheme } from '@/lib/theme/guard';
import { derive, THEME_VARS } from '@/lib/theme/derive';
import { INPUT_KEYS, PRESET_IDS, validateInputs } from '@/lib/theme/model';
import { EMBER_INPUTS, PRESET_BY_ID, PRESETS } from '@/lib/theme/presets';

describe('PRESETS', () => {
  it('are the five the owner picked, in order, with unique ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['ember', 'midnight', 'forest', 'nebula', 'mono']);
    expect(PRESETS.map((p) => p.id)).toEqual([...PRESET_IDS]);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(5);
  });

  it('Ember is the default look', () => {
    expect(PRESET_BY_ID.ember.inputs).toBe(EMBER_INPUTS);
  });

  it.each(PRESETS.map((p) => [p.id, p]))('%s is valid, all dark, and passes every readability pair', (_id, preset) => {
    expect(preset.name.length).toBeGreaterThan(0);
    expect(preset.description.length).toBeGreaterThan(0);
    expect(validateInputs(preset.inputs)).toEqual({ ok: true, inputs: preset.inputs });
    expect(Object.keys(preset.inputs).sort()).toEqual([...INPUT_KEYS].sort());
    const { vars, scheme } = derive(preset.inputs);
    expect(scheme).toBe('dark');
    expect(Object.keys(vars).sort()).toEqual([...THEME_VARS].sort());
    const findings = checkTheme(preset.inputs);
    expect(findings).toHaveLength(7);
    expect(findings.filter((f) => f.level !== 'ok')).toEqual([]);
  });

  it('look different from each other', () => {
    expect(new Set(PRESETS.map((p) => derive(p.inputs).vars['--background'])).size).toBe(5);
    expect(new Set(PRESETS.map((p) => derive(p.inputs).vars['--ember'])).size).toBe(5);
  });
});
