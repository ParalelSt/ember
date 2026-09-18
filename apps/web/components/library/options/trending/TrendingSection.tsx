'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, CloseIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { CollectionPage } from '@/components/library/CollectionPage';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ScaledFrame } from '@/components/library/options/changelog/ChangelogSection';
import { STALE_NOTE, TrendingShelf } from '@/components/library/options/trending/TrendingShelves';
import {
  TRENDING_OPTIONS,
  type TrendingData,
  type TrendingOption,
  type TrendingView,
} from '@/components/library/options/trending';
import { cn } from '@/lib/utils';
import { MOCK_CHART, MOCK_HOME_RECENT, MOCK_HOME_TRACKS } from '@/app/(app)/dizajn/mock';
import type { Track } from '@/types/track';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const CHART_TRACKS = MOCK_CHART.map((e) => e.track);
const NOOP = () => {};

/** A plain Home shelf of TrackCards (the live TrackShelf's markup), one
 *  row: six on desktop, two on phone. */
function MockShelf({ title, tracks, phone }: { title: string; tracks: Track[]; phone: boolean }) {
  return (
    <section className="mb-section">
      <SectionHeader
        title={title}
        className="mb-row"
        action={<span className="text-eyebrow">Show all ({tracks.length + 6})</span>}
      />
      <div className={cn('grid gap-block', phone ? 'grid-cols-2' : 'grid-cols-6')}>
        {tracks.slice(0, phone ? 2 : 6).map((t) => (
          <TrackCard key={t.id} track={t} onActivate={NOOP} />
        ))}
      </div>
    </section>
  );
}

/** The full chart behind Show all: the real CollectionPage (as Liked songs
 *  uses it) with ranked rows, under Home's Back link. No new route: this is
 *  Home's existing ?focus= view, drawn as a collection. */
function ChartCollection({ stale, onBack }: { stale: boolean; onBack: () => void }) {
  return (
    <div data-testid="trending-show-all">
      <button
        type="button"
        onClick={onBack}
        className="mb-block inline-flex items-center gap-inset text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Back
      </button>
      <CollectionPage
        eyebrow="Daily chart"
        title="Trending right now"
        meta={['Global', `${CHART_TRACKS.length} songs`, stale ? STALE_NOTE : 'Updated today']}
        cover={{ src: null, icon: null }}
        tracks={CHART_TRACKS}
        showRank
        context={{ type: 'radio' }}
        playback={{ play: NOOP, shuffle: NOOP, shuffleOn: false, active: false }}
        download={null}
        trackActions={{ currentId: null, isPlaying: false, likedIds: new Set<string>(), onPlay: NOOP, onToggle: NOOP, onLike: NOOP }}
        emptyMessage="The chart is not available right now."
      />
    </div>
  );
}

export interface TrendingSectionProps {
  option: TrendingOption;
  view: TrendingView;
  data: TrendingData;
  /** Show all and Back inside the preview move the View picker, so the
   *  mock clicks through like the real shelf would. */
  onViewChange: (view: TrendingView) => void;
}

/** The "Trending shelf" candidates in context: Home inside the whole Ember
 *  shell, desktop (scaled to fit) and phone (390px), with the chosen shelf
 *  between Recommended and Recently played, plus a 1:1 full-screen view.
 *  Mock data only. */
export function TrendingSection({ option, view, data, onViewChange }: TrendingSectionProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);
  const stale = data === 'stale';

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const description = TRENDING_OPTIONS.find((o) => o.id === option)?.description ?? '';

  const shell = (phone: boolean) => (
    <ShellPreview
      phone={phone}
      activePath="/"
      drawerOpen={phone && drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      content={
        view === 'show-all' ? (
          <ChartCollection stale={stale} onBack={() => onViewChange('shelf')} />
        ) : (
          <div data-testid="mock-home">
            <PageTitle className={cn('mb-section', phone ? 'text-3xl!' : 'text-4xl!')}>Home</PageTitle>
            <MockShelf title="Recommended for you" tracks={MOCK_HOME_TRACKS} phone={phone} />
            <TrendingShelf
              option={option}
              chart={MOCK_CHART}
              phone={phone}
              stale={stale}
              onShowAll={() => onViewChange('show-all')}
            />
            <MockShelf title="Recently played" tracks={MOCK_HOME_RECENT} phone={phone} />
          </div>
        )
      }
    />
  );

  return (
    <div data-testid="trending-section" data-option={option} data-view={view} data-data={data}>
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

      <p data-testid="trending-description" className="text-meta mt-block">
        {description}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen trending preview"
            data-testid="trending-fullscreen"
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
