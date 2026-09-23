import { PageTitle } from '@/components/page/PageTitle';
import { ColourControls } from '@/components/library/options/themes/ColourControls';
import { LiveThemePreview } from '@/components/library/options/themes/LiveThemePreview';
import { ThemesLibraryPanel } from '@/components/library/options/themes/ThemesLibraryPanel';
import { TabPanel, TabStrip, useTabStrip } from '@/components/library/options/themes/TabStrip';
import { MOCK_MY_THEMES, MOCK_SHARED_THEMES } from '@/components/library/options/themes/mock';
import type { ThemeLayoutContentProps } from '@/components/library/options/themes';

const TABS = [
  { id: 'presets', label: 'Presets' },
  { id: 'mine', label: 'My themes' },
  { id: 'colours', label: 'Colours' },
  { id: 'shared', label: 'Shared' },
];

/** Candidate (c), the third alternative: the live preview is pinned
 *  full-width at the top like a canvas, and a horizontal tab strip below it
 *  switches between four single-purpose panels. Built phone-first: the
 *  layout does not change shape between desktop and phone at all, only its
 *  width, since a single column and a scrolling tab strip already fit a
 *  phone without redesigning anything. */
export function ThemeLayoutStacked(props: ThemeLayoutContentProps) {
  const { phone, vars, inputs, activePresetId, activeMyThemeId, showWarning, readOnly, ownerName, shared, pinned } =
    props;
  const [tab, setTab] = useTabStrip(TABS);

  return (
    <div data-testid="theme-layout-stacked">
      <PageTitle className="mb-stack text-3xl!">Appearance</PageTitle>
      <div className="flex flex-col gap-stack">
        <LiveThemePreview vars={vars} showWarning={showWarning} className={phone ? 'h-64' : 'h-96'} />
        <TabStrip tabs={TABS} activeId={tab} onChange={setTab} />
        <div className={phone ? undefined : 'max-w-xl'}>
          <TabPanel id="presets" activeId={tab}>
            <ThemesLibraryPanel activePresetId={activePresetId} activeMyThemeId={null} />
          </TabPanel>
          <TabPanel id="mine" activeId={tab}>
            <div data-testid="my-themes-list" className="flex flex-col gap-row">
              <div className="text-eyebrow">My themes</div>
              {MOCK_MY_THEMES.map((t) => (
                <div
                  key={t.id}
                  data-testid="my-theme-row"
                  data-theme={t.id}
                  className={
                    t.id === activeMyThemeId
                      ? 'flex items-center justify-between gap-row rounded-md border border-ember bg-card px-row py-inset'
                      : 'flex items-center justify-between gap-row rounded-md border border-border px-row py-inset'
                  }
                >
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.shared ? 'Shared' : 'Not shared'}</span>
                </div>
              ))}
            </div>
          </TabPanel>
          <TabPanel id="colours" activeId={tab}>
            <ColourControls
              inputs={inputs}
              pinned={pinned}
              showWarning={showWarning}
              readOnly={readOnly}
              ownerName={ownerName}
              shared={shared}
            />
          </TabPanel>
          <TabPanel id="shared" activeId={tab}>
            <div data-testid="shared-themes-list" className="flex flex-col gap-row">
              <div className="text-eyebrow">Shared by others</div>
              {MOCK_SHARED_THEMES.map((t) => (
                <div
                  key={t.id}
                  data-testid="shared-theme-row"
                  className="flex items-center justify-between gap-row rounded-md border border-border px-row py-inset"
                >
                  <span className="truncate text-sm font-medium">
                    {t.name} <span className="text-muted-foreground">by {t.ownerName}</span>
                  </span>
                </div>
              ))}
            </div>
          </TabPanel>
        </div>
      </div>
    </div>
  );
}
