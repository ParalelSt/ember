import { PageTitle } from '@/components/page/PageTitle';
import { ColourControls } from '@/components/library/options/themes/ColourControls';
import { LiveThemePreview } from '@/components/library/options/themes/LiveThemePreview';
import { ThemesLibraryPanel } from '@/components/library/options/themes/ThemesLibraryPanel';
import { TabPanel, TabStrip, useTabStrip } from '@/components/library/options/themes/TabStrip';
import type { ThemeLayoutContentProps } from '@/components/library/options/themes';

const PHONE_TABS = [
  { id: 'themes', label: 'Themes' },
  { id: 'colours', label: 'Colours' },
];

/** Candidate (a): three columns. Left panel picks a theme (presets, My
 *  themes, Shared by others); the live preview sits in the middle; a right
 *  panel tunes the eight colours, the readability findings and sharing.
 *  On a phone the preview stays on top and the two panels collapse into a
 *  two-tab strip underneath it. */
export function ThemeLayoutPanels(props: ThemeLayoutContentProps) {
  const { phone, vars, inputs, activePresetId, activeMyThemeId, showWarning, readOnly, ownerName, shared, pinned } =
    props;
  const [tab, setTab] = useTabStrip(PHONE_TABS);

  const themesPanel = (
    <ThemesLibraryPanel activePresetId={activePresetId} activeMyThemeId={activeMyThemeId} />
  );
  const coloursPanel = (
    <ColourControls
      inputs={inputs}
      pinned={pinned}
      showWarning={showWarning}
      readOnly={readOnly}
      ownerName={ownerName}
      shared={shared}
    />
  );

  return (
    <div data-testid="theme-layout-panels">
      <PageTitle className="mb-stack text-3xl!">Appearance</PageTitle>
      {phone ? (
        <div className="flex flex-col gap-stack">
          <LiveThemePreview vars={vars} showWarning={showWarning} className="h-72" />
          <TabStrip tabs={PHONE_TABS} activeId={tab} onChange={setTab} />
          <TabPanel id="themes" activeId={tab}>
            {themesPanel}
          </TabPanel>
          <TabPanel id="colours" activeId={tab}>
            {coloursPanel}
          </TabPanel>
        </div>
      ) : (
        <div className="grid grid-cols-[15rem_1fr_15rem] gap-stack">
          {themesPanel}
          <LiveThemePreview vars={vars} showWarning={showWarning} className="min-h-112" />
          {coloursPanel}
        </div>
      )}
    </div>
  );
}
