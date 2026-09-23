import type { PresetId, ThemeInputs } from '@/lib/theme/model';

/** The five ready-made themes (plan section 2), all dark. Ember is today's
 *  look and the default; picking it applies no overrides at all, so the
 *  page is exactly the CSS in app/globals.css. Every preset passes the
 *  readability guard with nothing above "ok" (presets.test.ts holds that). */
export interface ThemePreset {
  id: PresetId;
  name: string;
  description: string;
  inputs: ThemeInputs;
}

export const EMBER_INPUTS: ThemeInputs = {
  background: [0.16, 0.005, 260],
  surface: [0.2, 0.005, 260],
  text: [0.98, 0, 0],
  mutedText: [0.7, 0.005, 260],
  accent: [0.68, 0.2, 25],
  accentHover: [0.78, 0.13, 25],
  border: [1, 0, 0],
  sidebar: [0.13, 0.005, 260],
};

export const PRESETS: readonly ThemePreset[] = [
  {
    id: 'ember',
    name: 'Ember',
    description: 'Warm red on near-black. The default.',
    inputs: EMBER_INPUTS,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue with an ice-blue accent.',
    inputs: {
      background: [0.17, 0.03, 262],
      surface: [0.21, 0.03, 262],
      text: [0.97, 0.01, 250],
      mutedText: [0.7, 0.02, 255],
      accent: [0.75, 0.14, 225],
      accentHover: [0.83, 0.1, 225],
      border: [1, 0, 0],
      sidebar: [0.14, 0.03, 262],
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Dark green with an amber accent.',
    inputs: {
      background: [0.17, 0.02, 150],
      surface: [0.21, 0.02, 150],
      text: [0.97, 0.005, 140],
      mutedText: [0.7, 0.02, 145],
      accent: [0.8, 0.16, 75],
      accentHover: [0.87, 0.12, 80],
      border: [1, 0, 0],
      sidebar: [0.14, 0.02, 150],
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Violet with a magenta accent.',
    inputs: {
      background: [0.16, 0.03, 300],
      surface: [0.2, 0.03, 300],
      text: [0.97, 0.01, 300],
      mutedText: [0.7, 0.03, 300],
      accent: [0.72, 0.19, 320],
      accentHover: [0.8, 0.14, 320],
      border: [1, 0, 0],
      sidebar: [0.13, 0.03, 300],
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Pure black with a white accent, for OLED phones.',
    inputs: {
      background: [0, 0, 0],
      surface: [0.12, 0, 0],
      text: [0.97, 0, 0],
      mutedText: [0.68, 0, 0],
      accent: [0.97, 0, 0],
      accentHover: [0.85, 0, 0],
      border: [1, 0, 0],
      sidebar: [0, 0, 0],
    },
  },
];

export const PRESET_BY_ID: Readonly<Record<PresetId, ThemePreset>> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
) as Record<PresetId, ThemePreset>;
