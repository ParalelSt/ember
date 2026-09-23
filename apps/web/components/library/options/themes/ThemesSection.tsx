'use client';

import { useState, type ComponentType } from 'react';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ThemeLayoutInspector } from '@/components/library/options/themes/ThemeLayoutInspector';
import { ThemeLayoutPanels } from '@/components/library/options/themes/ThemeLayoutPanels';
import { ThemeLayoutStacked } from '@/components/library/options/themes/ThemeLayoutStacked';
import {
  MOCK_CUSTOM_EDITING,
  MOCK_CUSTOM_EDITING_VARS,
  MOCK_CUSTOM_WARNING,
  MOCK_CUSTOM_WARNING_VARS,
  MOCK_MY_THEMES,
  THEME_PRESET_BY_ID,
  type PresetId,
  type ThemeInputsMock,
} from '@/components/library/options/themes/mock';
import type { ThemeGalleryState, ThemeLayoutContentProps, ThemeLayoutId } from '@/components/library/options/themes';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };

const LAYOUTS: Record<ThemeLayoutId, ComponentType<ThemeLayoutContentProps>> = {
  panels: ThemeLayoutPanels,
  inspector: ThemeLayoutInspector,
  stacked: ThemeLayoutStacked,
};

const PINNED_WHEN_EDITING: ReadonlySet<keyof ThemeInputsMock> = new Set(['accent', 'accentHover']);
const SHARED_PRESET_ID: PresetId = 'nebula';
const SHARED_OWNER = 'Luka';

/** For each gallery state, everything a layout candidate needs to render
 *  one frame: which inputs are "active", whether they are read-only (a
 *  theme someone else shared) and whether the readability warning shows.
 *  `midnight` is the default preset so the swatches read as visibly
 *  themed rather than looking like today's Ember. */
function contentForState(state: ThemeGalleryState): Omit<ThemeLayoutContentProps, 'phone'> {
  switch (state) {
    case 'preset': {
      const preset = THEME_PRESET_BY_ID.midnight;
      return {
        vars: preset.vars,
        inputs: preset.inputs,
        activePresetId: preset.id,
        activeMyThemeId: null,
        showWarning: false,
        readOnly: false,
        shared: false,
      };
    }
    case 'editing':
      return {
        vars: MOCK_CUSTOM_EDITING_VARS,
        inputs: MOCK_CUSTOM_EDITING,
        activePresetId: null,
        activeMyThemeId: MOCK_MY_THEMES[0].id,
        showWarning: false,
        readOnly: false,
        shared: MOCK_MY_THEMES[0].shared,
        pinned: PINNED_WHEN_EDITING,
      };
    case 'warning':
      return {
        vars: MOCK_CUSTOM_WARNING_VARS,
        inputs: MOCK_CUSTOM_WARNING,
        activePresetId: null,
        activeMyThemeId: MOCK_MY_THEMES[0].id,
        showWarning: true,
        readOnly: false,
        shared: MOCK_MY_THEMES[0].shared,
        pinned: PINNED_WHEN_EDITING,
      };
    case 'shared': {
      const preset = THEME_PRESET_BY_ID[SHARED_PRESET_ID];
      return {
        vars: preset.vars,
        inputs: preset.inputs,
        activePresetId: null,
        activeMyThemeId: null,
        showWarning: false,
        readOnly: true,
        ownerName: SHARED_OWNER,
      };
    }
    default:
      return contentForState('preset');
  }
}

export interface ThemesSectionProps {
  layout: ThemeLayoutId;
  state: ThemeGalleryState;
}

/** The whole "Appearance page as an editor" candidate, for one layout and
 *  one gallery state, at a scaled-down desktop frame and a 390px phone
 *  frame side by side (the same convention ChangelogSection uses). The
 *  outer `ShellPreview` is the ordinary Ember shell around Settings, left
 *  uncoloured: only the `LiveThemePreview` nested inside the candidate's
 *  content gets the theme's CSS variables, scoped to its own wrapper. */
export function ThemesSection({ layout, state }: ThemesSectionProps) {
  const [desktopScale, setDesktopScale] = useState(1);
  const Layout = LAYOUTS[layout];
  const content = contentForState(state);

  return (
    <div data-testid="themes-section" data-layout={layout} data-state={state}>
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1100_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center">
            <div className="text-eyebrow">
              Desktop <span className="normal-case tracking-normal">({Math.round(desktopScale * 100)}%)</span>
            </div>
          </div>
          <ScaledFrame width={DESKTOP.width} height={DESKTOP.height} onScale={setDesktopScale}>
            <ShellPreview
              phone={false}
              activePath=""
              content={<Layout phone={false} {...content} />}
            />
          </ScaledFrame>
        </div>
        <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center">
            <div className="text-eyebrow">Phone (390px)</div>
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            <ShellPreview
              phone
              activePath=""
              content={<Layout phone {...content} />}
            />
          </ScaledFrame>
        </div>
      </div>
    </div>
  );
}
