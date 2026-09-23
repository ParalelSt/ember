import { PageTitle } from '@/components/page/PageTitle';
import { ColourControls } from '@/components/library/options/themes/ColourControls';
import { LiveThemePreview } from '@/components/library/options/themes/LiveThemePreview';
import { ShareToggleRow } from '@/components/library/options/themes/ShareToggleRow';
import { ThemesLibraryPanel } from '@/components/library/options/themes/ThemesLibraryPanel';
import { TabPanel, TabStrip, useTabStrip } from '@/components/library/options/themes/TabStrip';
import type { ThemeLayoutContentProps } from '@/components/library/options/themes';

const TABS = [
  { id: 'themes', label: 'Themes' },
  { id: 'colours', label: 'Colours' },
  { id: 'share', label: 'Share' },
];

/** Candidate (b), recommended: the live preview takes most of the width,
 *  with one right-hand panel next to it that has three tabs (Themes,
 *  Colours, Share). On a phone the same tabbed panel drops below the
 *  preview at full width, so the layout does not have to be redesigned for
 *  the smaller screen, only stacked. */
export function ThemeLayoutInspector(props: ThemeLayoutContentProps) {
  const { phone, vars, inputs, activePresetId, activeMyThemeId, showWarning, readOnly, ownerName, shared, pinned } =
    props;
  const [tab, setTab] = useTabStrip(TABS);

  const inspector = (
    <div className="flex min-w-0 flex-col gap-stack">
      <TabStrip tabs={TABS} activeId={tab} onChange={setTab} />
      <TabPanel id="themes" activeId={tab}>
        <ThemesLibraryPanel activePresetId={activePresetId} activeMyThemeId={activeMyThemeId} />
      </TabPanel>
      <TabPanel id="colours" activeId={tab}>
        <ColourControls
          inputs={inputs}
          pinned={pinned}
          showWarning={showWarning}
          readOnly={readOnly}
          ownerName={ownerName}
          hideShareToggle
        />
      </TabPanel>
      <TabPanel id="share" activeId={tab}>
        {readOnly && ownerName ? (
          <p data-testid="share-tab-readonly-note" className="text-xs text-muted-foreground">
            Shared by {ownerName}. Only {ownerName} can turn sharing off.
          </p>
        ) : (
          <ShareToggleRow checked={!!shared} />
        )}
      </TabPanel>
    </div>
  );

  return (
    <div data-testid="theme-layout-inspector">
      <PageTitle className="mb-stack text-3xl!">Appearance</PageTitle>
      <div className={phone ? 'flex flex-col gap-stack' : 'flex items-start gap-stack'}>
        <LiveThemePreview
          vars={vars}
          showWarning={showWarning}
          className={phone ? 'h-72' : 'min-h-112 flex-1'}
        />
        <div className={phone ? undefined : 'w-72 shrink-0'}>{inspector}</div>
      </div>
    </div>
  );
}
