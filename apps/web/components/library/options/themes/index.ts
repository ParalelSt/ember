import type { PickerOption } from '@/components/library/options';
import type { PresetId, ThemeInputsMock } from '@/components/library/options/themes/mock';

/** What every layout candidate needs to render one gallery state: the
 *  active preview's derived vars and inputs, which entries in the two
 *  lists are "selected", and whether this frame is showing the
 *  readability warning or a read-only shared theme. */
export interface ThemeLayoutContentProps {
  phone: boolean;
  vars: Record<string, string>;
  inputs: ThemeInputsMock;
  activePresetId: PresetId | null;
  activeMyThemeId: string | null;
  showWarning: boolean;
  readOnly: boolean;
  ownerName?: string;
  shared?: boolean;
  pinned?: ReadonlySet<keyof ThemeInputsMock>;
}

/** Task 0 candidates for Settings > Appearance
 *  (docs/superpowers/plans/2026-09-23-themes.md), after the owner's change
 *  of direction: not separate questions for presets/editor/live, but one
 *  question, the whole page's shape: an editor with a live preview of the
 *  app in the middle that recolours as you change things, and panels
 *  around it for picking a preset or a saved theme, tuning the eight
 *  colours, and sharing. */
export type ThemeLayoutId = 'panels' | 'inspector' | 'stacked';

export interface ThemeLayoutCandidate extends PickerOption {
  id: ThemeLayoutId;
  badge?: string;
}

export const THEME_LAYOUT_RECOMMENDED: ThemeLayoutId = 'inspector';
export const THEME_LAYOUT_RECOMMENDED_REASON =
  'The preview stays the biggest thing on screen, which is the point of an editor: one right-hand panel with three tabs needs no side-by-side column math, and on a phone it just drops below the preview unchanged instead of turning into a different layout.';

export const THEME_LAYOUT_OPTIONS: ThemeLayoutCandidate[] = [
  {
    id: 'panels',
    name: 'Three panels',
    description:
      'A left panel holds Presets, My themes (new, rename, duplicate, delete) and Shared by others; a right panel holds the eight colour rows, the readability findings and the Share toggle; the live preview sits between them. On a phone the preview stays on top and the two panels become a two-tab strip (Themes, Colours) underneath it.',
  },
  {
    id: 'inspector',
    badge: 'Recommended',
    name: 'Preview + inspector',
    description:
      'The live preview takes most of the width, with one right-hand panel next to it that has three tabs: Themes (presets, My themes, Shared by others), Colours (the eight rows and the readability findings) and Share (the toggle, who it is shared with). On a phone the same tabbed panel drops below the preview at full width.',
  },
  {
    id: 'stacked',
    name: 'Preview on top, tabs below',
    description:
      'The live preview is pinned full-width at the top like a canvas; a horizontal tab strip below it switches between four panels: Presets, My themes, Colours and Shared, each with its own scroll. Built phone-first: on a phone it is exactly the same layout, just narrower, rather than turning into panels or a sheet.',
  },
];

/** The state picker: what the editor is showing, independent of layout.
 *  "warning" is the one frame that must show a failing readability pair
 *  with its Fix it button (Task 0 requirement); "shared" shows a theme
 *  someone else shared in use, read-only except for "Copy to my themes". */
export type ThemeGalleryState = 'preset' | 'editing' | 'warning' | 'shared';

export const THEME_STATES: { id: ThemeGalleryState; name: string; description: string }[] = [
  {
    id: 'preset',
    name: 'A preset chosen',
    description: 'Midnight picked as-is from the five presets. Nothing edited, nothing to save.',
  },
  {
    id: 'editing',
    name: 'Editing a custom theme',
    description:
      'Midnight nudged towards a brighter, more violet accent. The Basics changed; More auto-filled from them, nothing pinned yet.',
  },
  {
    id: 'warning',
    name: 'Readability warning',
    description:
      'The accent pushed close to the background’s own colour: links and the active nav item read as "hard to read", with a Fix it button. Saving to the account is blocked until it clears; the local preview still shows it.',
  },
  {
    id: 'shared',
    name: 'Using a shared theme',
    description:
      '"Cold brew", shared by Luka, in use. The colours are read-only (only Luka can edit, rename, unshare or delete the original); "Copy to my themes" makes an editable copy.',
  },
];
