import { ChevronDownIcon, ChevronUpIcon, ClockIcon, PlayIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import { cn } from '@/lib/utils';
import type { ChartMovement, MockChartEntry } from '@/app/(app)/dizajn/mock';
import type { TrendingOption } from '@/components/library/options/trending';

export const STALE_NOTE = 'Updated 3 hours ago';

export function movementLabel(movement: ChartMovement, change?: number): string {
  const places = `${change ?? 1} ${change === 1 ? 'place' : 'places'}`;
  if (movement === 'up') return `Up ${places} since yesterday`;
  if (movement === 'down') return `Down ${places} since yesterday`;
  if (movement === 'new') return 'New on the chart today';
  return 'Same place as yesterday';
}

/** The small up / down / new / unchanged marker next to a rank. */
export function MovementMarker({ entry, className }: { entry: MockChartEntry; className?: string }) {
  const label = movementLabel(entry.movement, entry.change);
  const common = cn('inline-flex items-center text-[11px] font-semibold tabular-nums leading-none', className);
  if (entry.movement === 'up') {
    return (
      <span data-testid="movement" data-movement="up" aria-label={label} title={label} className={cn(common, 'text-ember')}>
        <ChevronUpIcon className="size-3" />
        {entry.change}
      </span>
    );
  }
  if (entry.movement === 'down') {
    return (
      <span data-testid="movement" data-movement="down" aria-label={label} title={label} className={cn(common, 'text-muted-foreground')}>
        <ChevronDownIcon className="size-3" />
        {entry.change}
      </span>
    );
  }
  if (entry.movement === 'new') {
    return (
      <span
        data-testid="movement"
        data-movement="new"
        aria-label={label}
        title={label}
        className={cn(common, 'h-4 rounded-full bg-ember/15 px-inset text-[9px] uppercase tracking-wider text-ember')}
      >
        New
      </span>
    );
  }
  return (
    <span data-testid="movement" data-movement="same" aria-label={label} title={label} className={cn(common, 'h-3')}>
      <span className="block h-0.5 w-2.5 rounded-full bg-muted-foreground/50" />
    </span>
  );
}

/** Heading row shared by the three candidates: the title, the stale note
 *  under it when the chart could not be refreshed, and Show all. */
function ShelfHeader({ total, stale, onShowAll }: { total: number; stale: boolean; onShowAll: () => void }) {
  return (
    <div className="mb-row flex items-baseline justify-between gap-row">
      <div className="min-w-0">
        <h2 className="text-section-title">Trending right now</h2>
        {stale && (
          <p data-testid="stale-note" className="text-meta mt-inset flex items-center gap-inset">
            <ClockIcon className="size-3.5 shrink-0" />
            {STALE_NOTE}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onShowAll}
        className="text-eyebrow shrink-0 transition-colors hover:text-foreground"
      >
        Show all ({total})
      </button>
    </div>
  );
}

/** Ranked cards: TrackCard's markup with the rank set large on the cover's
 *  bottom-left corner, and the movement marker beside the artist. Title and
 *  artist keep the card's full width. */
function RankedCard({ entry, rank }: { entry: MockChartEntry; rank: number }) {
  const t = entry.track;
  return (
    <div data-testid="chart-entry" className="group relative cursor-pointer rounded-xl bg-card p-block transition-colors hover:bg-card/80">
      <div className="relative">
        <Artwork src={t.artworkUrl} className="aspect-square w-full rounded-lg bg-art shadow-soft" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 rounded-b-lg bg-linear-to-t from-black/70 to-transparent" />
        <span
          data-testid="chart-rank"
          className="absolute bottom-1 left-2.5 text-4xl font-black leading-none tracking-tighter text-white tabular-nums drop-shadow-md"
        >
          {rank}
        </span>
      </div>
      <div className="mt-row truncate text-sm font-semibold">{t.title}</div>
      <div className="mt-inset flex items-center gap-cluster">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.artist}</div>
        <MovementMarker entry={entry} className="shrink-0" />
      </div>
      <PlayButton
        size="sm"
        label={`Play ${t.title}`}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-14 right-4 translate-y-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100"
      />
    </div>
  );
}

/** One compact chart row: rank, cover (play on hover), title and artist,
 *  movement. Used by Chart list and by Hero + list. */
export function ChartRow({ entry, rank }: { entry: MockChartEntry; rank: number }) {
  const t = entry.track;
  return (
    <div
      data-testid="chart-entry"
      className="group grid cursor-pointer grid-cols-[1.75rem_auto_minmax(0,1fr)_2rem] items-center gap-row rounded-md px-cluster py-cluster transition-colors hover:bg-card"
    >
      <span data-testid="chart-rank" className="text-right text-lg font-bold tabular-nums">
        {rank}
      </span>
      <div className="relative">
        <Artwork src={t.artworkUrl} size="sm" className="rounded-md bg-art" />
        <button
          type="button"
          aria-label={`Play ${t.title}`}
          className="absolute inset-0 grid place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <PlayIcon className="size-4 fill-current" />
        </button>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{t.title}</div>
        <div className="mt-inset truncate text-xs text-muted-foreground">{t.artist}</div>
      </div>
      <div className="flex justify-center">
        <MovementMarker entry={entry} />
      </div>
    </div>
  );
}

function RankedCardsShelf({ chart, phone }: { chart: MockChartEntry[]; phone: boolean }) {
  const count = phone ? 2 : 6;
  return (
    <div className={cn('grid gap-block', phone ? 'grid-cols-2' : 'grid-cols-6')}>
      {chart.slice(0, count).map((e, i) => (
        <RankedCard key={e.track.id} entry={e} rank={i + 1} />
      ))}
    </div>
  );
}

function ChartListShelf({ chart, phone }: { chart: MockChartEntry[]; phone: boolean }) {
  return (
    <div className={cn('grid gap-x-stack', phone ? 'grid-cols-1' : 'grid-flow-col grid-cols-2 grid-rows-5')}>
      {chart.slice(0, 10).map((e, i) => (
        <ChartRow key={e.track.id} entry={e} rank={i + 1} />
      ))}
    </div>
  );
}

function HeroListShelf({ chart, phone }: { chart: MockChartEntry[]; phone: boolean }) {
  const top = chart[0];
  const t = top.track;
  return (
    <div className={cn('grid gap-stack', phone ? 'grid-cols-1' : 'grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-stretch')}>
      <div
        data-testid="chart-entry"
        className="group relative flex cursor-pointer items-center overflow-hidden rounded-xl bg-card"
      >
        {/* The cover, blurred, tints the card the way a now-playing view does. */}
        <Artwork src={t.artworkUrl} className="absolute inset-0 scale-125 opacity-35 blur-2xl" />
        <div className={cn('relative flex w-full items-center', phone ? 'gap-block p-block' : 'gap-stack p-stack')}>
          <Artwork
            src={t.artworkUrl}
            className={cn('shrink-0 rounded-lg bg-art shadow-soft', phone ? 'size-28' : 'size-art-md')}
          />
          <div className="min-w-0 flex-1">
            <div className="text-eyebrow flex items-center gap-cluster text-ember">
              <span data-testid="chart-rank">No. 1</span> today
            </div>
            <div className={cn('mt-cluster truncate font-bold tracking-tight', phone ? 'text-2xl' : 'text-3xl')}>{t.title}</div>
            <div className="mt-inset truncate text-sm text-muted-foreground">{t.artist}</div>
            <div className="mt-block flex items-center gap-row">
              <PlayButton size={phone ? 'sm' : 'md'} label={`Play ${t.title}`} />
              <span className="flex items-center gap-inset whitespace-nowrap text-xs text-muted-foreground">
                <MovementMarker entry={top} />
                {top.movement === 'same' ? 'Same as yesterday' : top.movement === 'new' ? 'New today' : 'since yesterday'}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between">
        {chart.slice(1, 6).map((e, i) => (
          <ChartRow key={e.track.id} entry={e} rank={i + 2} />
        ))}
      </div>
    </div>
  );
}

const SHELVES: Record<TrendingOption, typeof RankedCardsShelf> = {
  'ranked-cards': RankedCardsShelf,
  'chart-list': ChartListShelf,
  'hero-list': HeroListShelf,
};

export interface TrendingShelfProps {
  option: TrendingOption;
  chart: MockChartEntry[];
  phone: boolean;
  stale: boolean;
  onShowAll: () => void;
}

/** Presentational only, mock data only: one candidate for Home's
 *  "Trending right now" shelf, header included. */
export function TrendingShelf({ option, chart, phone, stale, onShowAll }: TrendingShelfProps) {
  const Shelf = SHELVES[option];
  return (
    <section data-testid="trending-shelf" data-option={option} className="mb-section">
      <ShelfHeader total={chart.length} stale={stale} onShowAll={onShowAll} />
      <Shelf chart={chart} phone={phone} />
    </section>
  );
}
