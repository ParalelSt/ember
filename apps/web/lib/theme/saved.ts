import { cleanThemeName, isPresetId, isRecordId, THEME_NAME_MAX, type PresetId, type ThemeDoc, type ThemeInputs } from '@/lib/theme/model';

/** Saved themes (the owner's decision 4): a named list per person in the
 *  `themes` collection, each optionally shared with everyone. Shapes shared
 *  by the routes and the client. */

/** How many custom themes one person can keep. */
export const THEME_CAP = 20;

/** One of my saved themes. */
export interface SavedTheme {
  id: string;
  name: string;
  /** The preset it started from. */
  base: PresetId;
  inputs: ThemeInputs;
  /** Shared with everyone on this server. */
  shared: boolean;
  created: string;
  updated: string;
}

/** Someone else's theme, shared with everyone. Read-only to me. */
export interface SharedTheme {
  id: string;
  name: string;
  base: PresetId;
  inputs: ThemeInputs;
  /** The creator's display name, for "by Luka". */
  ownerName: string;
  updated: string;
}

export interface ThemesList {
  mine: SavedTheme[];
  shared: SharedTheme[];
  cap: number;
}

/** What `PATCH /api/theme` accepts: a preset, or a saved theme (mine or
 *  shared) by id. The server resolves either to colours. */
export type ThemeSelection = { preset: PresetId } | { themeId: string };

export function parseSelection(raw: unknown): ThemeSelection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 1) return null;
  if (isPresetId(body.preset)) return { preset: body.preset };
  if (isRecordId(body.themeId)) return { themeId: body.themeId };
  return null;
}

/** The active-theme doc for a saved or shared theme: its colours copied in. */
export function docFromSaved(theme: Pick<SavedTheme, 'id' | 'name' | 'base' | 'inputs'>): ThemeDoc {
  return { v: 1, preset: theme.base, custom: theme.inputs, name: theme.name, themeId: theme.id };
}

/** The doc for a selection that needs no lookup: a preset. */
export function docFromPreset(preset: PresetId): ThemeDoc {
  return { v: 1, preset };
}

/** "Late shift" -> "Late shift copy", still within the 40-character limit. */
export function copyName(name: string): string {
  const suffix = ' copy';
  const base = cleanThemeName(name) ?? 'Theme';
  return base.length + suffix.length <= THEME_NAME_MAX
    ? base + suffix
    : base.slice(0, THEME_NAME_MAX - suffix.length).trimEnd() + suffix;
}

/** The same colours and name with the link to the original dropped: what
 *  someone keeps when the theme they use is deleted or unshared. */
export function detach(doc: ThemeDoc): ThemeDoc {
  const rest = { ...doc };
  delete rest.themeId;
  return rest;
}
