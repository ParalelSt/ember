'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, MicIcon, MusicIcon, SearchIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { SearchRow } from '@/components/library/options/searchrows/SearchRow';
import {
  RECOMMENDED_ROW,
  ROW_CONTROLS,
  ROW_INDICATORS,
  type RowControl,
  type RowIndicator,
  type RowState,
} from '@/components/library/options/searchrows';
import { cn } from '@/lib/utils';
import {
  MOCK_HOME_TRACKS,
  MOCK_SEARCH_PLAYING_ID,
  MOCK_SEARCH_RECENTS,
  MOCK_SEARCH_RESULTS,
} from '@/app/(app)/dizajn/mock';

// A little taller than the other sections' 1100x700 shell: the overlay is
// the whole point here, and at 700 its last result row fell below the
// popup's scroll edge.
const DESKTOP = { width: 1100, height: 790 };
const PHONE = { width: 390, height: 780 };
const NOOP = () => {};

/** A plain Home behind the overlay, so the backdrop has a real page under
 *  it rather than an empty box. */
function MockHome({ phone }: { phone: boolean }) {
  return (
    <div data-testid="searchrows-home">
      <PageTitle className={cn('mb-section', phone ? 'text-3xl!' : 'text-4xl!')}>Home</PageTitle>
      <SectionHeader title="Recommended for you" className="mb-row" />
      <div className={cn('grid gap-block', phone ? 'grid-cols-2' : 'grid-cols-6')}>
        {MOCK_HOME_TRACKS.slice(0, phone ? 2 : 6).map((t) => (
          <TrackCard key={t.id} track={t} onActivate={NOOP} artworkFallback={<MusicIcon className="h-6 w-6" />} />
        ))}
      </div>
    </div>
  );
}

/** SearchOverlay's popup drawn in place instead of portalled, so it sits
 *  inside the gallery's shell frame: the classes are the real
 *  DialogContent's plus SearchOverlay's own, with spacing on tokens. The
 *  query is empty, which is the overlay state that shows recents AND a
 *  list at once, so both row shapes are visible in one picture. */
function OverlayPanel({
  phone,
  control,
  indicator,
  state,
  activeId,
  onActivate,
}: {
  phone: boolean;
  control: RowControl;
  indicator: RowIndicator;
  state: RowState;
  activeId: string | null;
  onActivate: (id: string) => void;
}) {
  const rowProps = (id: string) => ({
    control,
    indicator,
    active: state !== 'idle' && activeId === id,
    playing: state === 'playing',
    onActivate: () => onActivate(id),
  });

  return (
    <div data-testid="searchrows-overlay" className="absolute inset-0 z-40">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" />
      <div
        className={cn(
          'absolute left-1/2 top-8 flex max-h-[86%] w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-block overflow-hidden rounded-xl bg-popover p-block text-sm text-popover-foreground shadow-soft ring-1 ring-foreground/10',
          !phone && 'max-w-xl',
        )}
      >
        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            readOnly
            value=""
            onChange={NOOP}
            placeholder="What do you want to listen to?"
            className="h-12 rounded-full border-0 bg-card pl-11 pr-20"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search by voice"
            className="absolute right-10 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
          >
            <MicIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close search"
            className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </Button>
        </div>

        <div className="-mx-block min-h-0 flex-1 overflow-y-auto px-block">
          <div className="mb-cluster">
            <SectionHeader title="Recent searches" className="mb-row" />
            <div className="flex flex-col">
              {MOCK_SEARCH_RECENTS.map((t) => (
                <SearchRow key={t.id} track={t} density="compact" {...rowProps(t.id)} />
              ))}
            </div>
          </div>
          <SectionHeader title="Trending" className="mb-block mt-stack" />
          {/* The container-query root the live TrackList is, so the rows
              size their columns against the popup, not the window. */}
          <div className="@container flex flex-col">
            {MOCK_SEARCH_RESULTS.map((t) => (
              <SearchRow key={t.id} track={t} density="list" {...rowProps(t.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SearchRowsSectionProps {
  control: RowControl;
  indicator: RowIndicator;
  state: RowState;
  /** Pressing a row's control inside the preview moves the State picker,
   *  so the mock plays and pauses like the real overlay would. */
  onStateChange: (state: RowState) => void;
}

/** The "Search rows" candidates in context: the search overlay over the
 *  whole Ember shell, desktop (scaled to fit) and phone (390px), plus a 1:1
 *  full-screen view. Mock data only, nothing fetches. */
export function SearchRowsSection({ control, indicator, state, onStateChange }: SearchRowsSectionProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const [activeId, setActiveId] = useState(MOCK_SEARCH_PLAYING_ID);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Pressing a control: a different row takes over and starts, the current
  // row toggles between playing and paused.
  const activate = (id: string) => {
    if (state !== 'idle' && id === activeId) {
      onStateChange(state === 'playing' ? 'paused' : 'playing');
      return;
    }
    setActiveId(id);
    onStateChange('playing');
  };

  const recommended = control === RECOMMENDED_ROW.control && indicator === RECOMMENDED_ROW.indicator;
  const controlCopy = ROW_CONTROLS.find((o) => o.id === control)?.description ?? '';
  const indicatorCopy = ROW_INDICATORS.find((o) => o.id === indicator)?.description ?? '';

  const shell = (phone: boolean) => (
    <ShellPreview
      phone={phone}
      activePath="/"
      content={<MockHome phone={phone} />}
      modal={
        <OverlayPanel
          phone={phone}
          control={control}
          indicator={indicator}
          state={state}
          activeId={state === 'idle' ? null : activeId}
          onActivate={activate}
        />
      }
    />
  );

  return (
    <div
      data-testid="searchrows-section"
      data-control={control}
      data-indicator={indicator}
      data-state={state}
    >
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

      <div className="mt-block flex flex-col gap-cluster">
        {recommended && (
          <span
            data-testid="searchrows-recommended"
            className="w-fit rounded-full bg-ember px-row py-inset text-xs font-medium text-white"
          >
            Recommended
          </span>
        )}
        <p data-testid="searchrows-control-copy" className="text-meta">
          {controlCopy}
        </p>
        <p data-testid="searchrows-indicator-copy" className="text-meta">
          {indicatorCopy}
        </p>
      </div>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen search rows preview"
            data-testid="searchrows-fullscreen"
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
