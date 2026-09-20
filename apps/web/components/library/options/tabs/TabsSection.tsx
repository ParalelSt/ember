'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, MusicIcon, PauseIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { TabScore } from '@/components/library/options/tabs/TabScore';
import { TabsToolbar as LiveToolbar } from '@/components/tabs/TabsToolbar';
import { TabSheetHeader, TabSourceChip } from '@/components/tabs/TabSheetHeader';
import { SAMPLE_SONG, SAMPLE_TRACKS } from '@/components/library/options/tabs/sample';
import {
  TABS_LAYOUTS,
  type TabsLayout,
  type TabsScroll,
  type TabsStaff,
} from '@/components/library/options/tabs';
import { cn } from '@/lib/utils';
import { MOCK_HOME_RECENT, MOCK_HOME_TRACKS } from '@/app/(app)/dizajn/mock';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const NOOP = () => {};

interface ViewProps {
  phone: boolean;
  staff: TabsStaff;
  scroll: TabsScroll;
  track: number;
  onStaffChange: (staff: TabsStaff) => void;
  onScrollChange: (scroll: TabsScroll) => void;
  onTrackChange: (track: number) => void;
}

function metaLine(track: number): string {
  const t = SAMPLE_TRACKS[track];
  return `${SAMPLE_SONG.artist} · ${SAMPLE_SONG.tempo} bpm · ${SAMPLE_SONG.key} · ${t.instrument}, ${t.tuning} (${t.strings})`;
}

/** The live toolbar with the sample's tracks, and the practice controls
 *  (speed, loop, count-in) still shown as the stage 4 preview. */
function TabsToolbar({ floating, ...p }: ViewProps & { floating?: boolean }) {
  return <LiveToolbar {...p} tracks={SAMPLE_TRACKS} practice floating={floating} />;
}

/** A. Its own page: header, sticky toolbar, score in the content column. */
function SheetPage(p: ViewProps) {
  return (
    <div data-testid="tabs-layout-sheet">
      <TabSheetHeader
        phone={p.phone}
        title={SAMPLE_SONG.title}
        meta={metaLine(p.track)}
        chip={<TabSourceChip label="File added by Aron, shared" />}
      />
      <div className="sticky top-0 z-20 mt-block border-b border-border bg-background/95 py-cluster backdrop-blur">
        <TabsToolbar {...p} />
      </div>
      <TabScore
        staff={p.staff}
        scroll={p.scroll}
        track={p.track}
        scale={p.phone ? 0.65 : 0.95}
        className="mt-block"
      />
    </div>
  );
}

/** Home as it sits behind the panel (B, desktop). */
function MockHome({ besidePanel = false }: { besidePanel?: boolean }) {
  return (
    // Beside the desktop panel, Home keeps to the space left of it.
    <div data-testid="mock-home" style={besidePanel ? { marginRight: 440 } : undefined}>
      <PageTitle className="mb-section text-4xl!">Home</PageTitle>
      {[
        { title: 'Recommended for you', tracks: MOCK_HOME_TRACKS },
        { title: 'Recently played', tracks: MOCK_HOME_RECENT },
      ].map((s) => (
        <section key={s.title} className="mb-section">
          <SectionHeader title={s.title} className="mb-row" />
          <div className={cn('grid gap-block', besidePanel ? 'grid-cols-2' : 'grid-cols-4')}>
            {s.tracks.slice(0, 4).map((t) => (
              <TrackCard key={t.id} track={t} onActivate={NOOP} artworkFallback={<MusicIcon className="h-6 w-6" />} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PanelHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-row">
      <div className="min-w-0">
        <div className="text-eyebrow">Guitar tab</div>
        <div className="truncate font-semibold">
          {SAMPLE_SONG.title} <span className="font-normal text-muted-foreground">· {SAMPLE_SONG.artist}</span>
        </div>
      </div>
      <button
        type="button"
        aria-label="Close tab"
        onClick={onClose}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/** B, desktop: a right column like Lyrics, over the content column. */
function SidePanel(p: ViewProps) {
  return (
    <aside
      data-testid="tabs-layout-side-panel"
      aria-label="Guitar tab"
      className="absolute inset-y-0 right-0 z-20 flex w-[440px] flex-col gap-row border-l border-sidebar-border bg-sidebar p-block text-sidebar-foreground"
    >
      <PanelHeader />
      <TabsToolbar {...p} />
      <TabScore staff={p.staff} scroll={p.scroll} track={p.track} scale={0.75} className="min-h-0 flex-1 overflow-y-auto" />
    </aside>
  );
}

/** B, phone: a full-screen sheet opened from Now playing. */
function PhoneSheet(p: ViewProps) {
  return (
    <div data-testid="tabs-layout-side-panel" className="absolute inset-0 z-40 flex flex-col">
      <div aria-hidden className="h-page shrink-0 bg-black/40" />
      <div className="flex min-h-0 flex-1 flex-col gap-row rounded-t-2xl border-t border-border bg-sidebar px-block pb-block shadow-soft">
        <div aria-hidden className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-muted" />
        <PanelHeader />
        <TabsToolbar {...p} />
        <TabScore staff={p.staff} scroll={p.scroll} track={p.track} scale={0.65} className="min-h-0 flex-1 overflow-y-auto" />
      </div>
    </div>
  );
}

/** C: full-bleed score over everything, a floating toolbar at the bottom. */
function Stage(p: ViewProps) {
  return (
    <div data-testid="tabs-layout-stage" className="absolute inset-0 z-40 flex flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-row px-page py-row">
        <div className="min-w-0 truncate text-sm">
          <span className="font-semibold">{SAMPLE_SONG.title}</span>{' '}
          <span className="text-muted-foreground">· {SAMPLE_SONG.artist}</span>
        </div>
        <button
          type="button"
          aria-label="Leave stage"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <TabScore
        staff={p.staff}
        scroll={p.scroll}
        track={p.track}
        scale={p.phone ? 0.7 : 1.05}
        className={cn('min-h-0 flex-1 px-page pb-[88px]', p.scroll === 'vertical' && 'overflow-y-auto')}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-block pb-block">
        <div className="pointer-events-auto flex max-w-full items-center gap-cluster">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background shadow-soft">
            <PauseIcon className="h-4 w-4 fill-current" />
          </span>
          <div className="min-w-0">
            <TabsToolbar {...p} floating />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface TabsSectionProps {
  layout: TabsLayout;
  staff: TabsStaff;
  scroll: TabsScroll;
  /** The toolbar's Tab or Tab + Score and Horizontal move the page pickers,
   *  so the preview clicks through like the real toolbar would. */
  onStaffChange: (staff: TabsStaff) => void;
  onScrollChange: (scroll: TabsScroll) => void;
}

/** The "Guitar tabs" candidates in context: the whole Ember shell, desktop
 *  (scaled to fit) and phone (390px), plus a 1:1 full-screen view. The
 *  score in every frame is real AlphaTab drawing the bundled sample; only
 *  the playback-bound controls are inert. */
export function TabsSection({ layout, staff, scroll, onStaffChange, onScrollChange }: TabsSectionProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const [track, setTrack] = useState(0);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const description = TABS_LAYOUTS.find((o) => o.id === layout)?.description ?? '';

  const shell = (phone: boolean) => {
    const view: ViewProps = { phone, staff, scroll, track, onStaffChange, onScrollChange, onTrackChange: setTrack };
    let content: ReactNode;
    let overlay: ReactNode = null;
    let cover: ReactNode = null;
    if (layout === 'sheet') content = <SheetPage {...view} />;
    else if (layout === 'side-panel') {
      content = <MockHome besidePanel={!phone} />;
      if (phone) cover = <PhoneSheet {...view} />;
      else overlay = <SidePanel {...view} />;
    } else {
      content = <MockHome />;
      cover = <Stage {...view} />;
    }
    return (
      <div className="relative h-full w-full">
        <ShellPreview
          phone={phone}
          activePath=""
          drawerOpen={phone && drawerOpen}
          onDrawerOpenChange={setDrawerOpen}
          content={content}
          overlay={overlay}
        />
        {cover}
      </div>
    );
  };

  return (
    <div data-testid="tabs-section" data-layout={layout} data-staff={staff} data-scroll={scroll}>
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1100_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center justify-between gap-row">
            <div className="text-eyebrow">
              Desktop <span className="normal-case tracking-normal">({Math.round(desktopScale * 100)}%)</span>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="rounded-full border border-border px-row py-inset text-xs font-medium transition-colors hover:bg-card"
            >
              View full screen
            </button>
          </div>
          <ScaledFrame width={DESKTOP.width} height={DESKTOP.height} onScale={setDesktopScale}>
            {shell(false)}
          </ScaledFrame>
        </div>
        <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
          <div className="mb-cluster flex min-h-7 items-center">
            <div className="text-eyebrow">Phone (390px)</div>
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            {shell(true)}
          </ScaledFrame>
        </div>
      </div>

      <p data-testid="tabs-description" className="text-meta mt-block">
        {description}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen tabs preview"
            data-testid="tabs-fullscreen"
            className="fixed inset-0 z-[70] bg-background"
          >
            {shell(false)}
            <div className="absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-cluster rounded-full border border-border bg-popover/95 py-inset pl-block pr-inset text-xs text-muted-foreground shadow-soft backdrop-blur">
              Full-size preview, Esc to close
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Close full screen"
                className="grid h-7 w-7 place-items-center rounded-full text-foreground transition-colors hover:bg-muted"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
