import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import { RowHeader, WideRowHeader } from '@/components/page/RowShelf';
import { Skeleton } from '@/components/ui/skeleton';
import type { Track } from '@/types/track';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The big card plus this many songs listed under it. */
export const HERO_SONGS = 3;

/** The desktop's wide card lists this many songs beside its art. */
export const HERO_SONGS_WIDE = 4;

export interface BecauseYouPlayedProps {
  title: string;
  /** The artist of the song the suggestions grew from ("More like X"). */
  seedArtist?: string;
  tracks: Track[];
  loading?: boolean;
  /** The player's current track, to mark it and toggle on a re-tap. */
  currentId?: string | null;
  isPlaying?: boolean;
  /** Start `track` with the whole suggestion list as the queue. */
  onPlay: (track: Track, list: Track[]) => void;
  /** Play/pause the current track. */
  onToggle: () => void;
  /** Where "Show all" points; it only shows when there are more songs than
   *  the card holds. */
  showAllHref?: string;
  /** 'phone' (default): the picture card with three songs under it.
   *  'wide': the desktop's card across the full width, art on the left and
   *  four songs on the right. */
  variant?: 'phone' | 'wide';
}

/** Presentational only: the phone Home's "Because you played" feature, the
 *  owner's hero pick. A large picture card (the first suggestion's art
 *  under a dark gradient, its title and "artist · More like <seed>", an
 *  ember play button bottom right) and the next three songs listed under
 *  it. The play button plays the list from the top; a song row plays from
 *  that song. It sits in the page's gutter like everything else, never
 *  bleeding past it. */
export function BecauseYouPlayed({
  title,
  seedArtist,
  tracks,
  loading,
  currentId,
  isPlaying = false,
  onPlay,
  onToggle,
  showAllHref,
  variant = 'phone',
}: BecauseYouPlayedProps) {
  if (!loading && tracks.length === 0) return null;
  const [hero, ...rest] = tracks;
  const wide = variant === 'wide';
  const rows = rest.slice(0, wide ? HERO_SONGS_WIDE : HERO_SONGS);
  const shown = 1 + rows.length;
  const activate = (t: Track) => (currentId === t.id ? onToggle() : onPlay(t, tracks));
  const more = tracks.length > shown ? showAllHref : undefined;
  const byline = hero && seedArtist ? `${hero.artist} · More like ${seedArtist}` : hero?.artist;

  if (wide) {
    return (
      <section aria-label={title} className="mb-section">
        <WideRowHeader title={title} showAllHref={more} />
        {!hero ? (
          <Skeleton data-testid="hero-skeleton" className="h-[290px] w-full rounded-[14px]" />
        ) : (
          <div data-hero="wide" className="flex overflow-hidden rounded-[14px] bg-card">
            {/* At least square; taller only if the songs beside it need it. */}
            <div data-hero-art className="relative w-[min(290px,38%)] shrink-0">
              <div aria-hidden className="aspect-square" />
              <Artwork src={hero.artworkUrl} fallback="gradient" className="absolute inset-0 bg-art" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-transparent from-40% to-art/45" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[6px] px-[26px] py-[22px]">
              <div className="flex items-center gap-[14px]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ember">{title}</div>
                  <h3
                    className={cn(
                      'mt-inset line-clamp-2 break-words text-[30px] font-bold leading-[1.1] tracking-tight',
                      currentId === hero.id ? 'text-ember' : 'text-foreground',
                    )}
                  >
                    {hero.title}
                  </h3>
                  <div className="mt-inset truncate text-sm text-muted-foreground">{byline}</div>
                </div>
                <PlayButton
                  size="md"
                  label={currentId === hero.id && isPlaying ? 'Pause' : 'Play these songs'}
                  playing={currentId === hero.id && isPlaying}
                  onClick={() => activate(hero)}
                  className="shrink-0"
                />
              </div>
              {rows.length > 0 && (
                <ul className="mt-cluster">
                  {rows.map((t) => (
                    <li key={t.id} className="border-t border-border">
                      <button
                        type="button"
                        onClick={() => activate(t)}
                        className="flex w-full min-w-0 items-center gap-row rounded-[4px] py-[6px] text-left transition-colors hover:bg-foreground/5"
                      >
                        <Artwork src={t.artworkUrl} loading="lazy" className="size-[34px] shrink-0 rounded-[4px] bg-art" />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className={cn('block truncate text-sm font-semibold', currentId === t.id ? 'text-ember' : 'text-foreground')}>
                            {t.title}
                          </span>
                          <span className="block truncate text-[12.5px] text-muted-foreground">{t.artist}</span>
                        </span>
                        <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">{formatTime(t.durationSec, { empty: '' })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label={title} className="mb-section">
      <RowHeader title={title} showAllHref={more} />
      {!hero ? (
        <Skeleton data-testid="hero-skeleton" className="h-[178px] w-full rounded-[14px]" />
      ) : (
        <div data-hero className="overflow-hidden rounded-[14px] bg-card">
          <div className="relative flex h-[178px] items-end p-row">
            <Artwork src={hero.artworkUrl} fallback="gradient" className="absolute inset-0 bg-art" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-art/80" />
            <div className="relative z-[1] min-w-0 pr-[46px] text-foreground">
              <div className={cn('line-clamp-2 break-words text-[19px] font-bold leading-tight', currentId === hero.id && 'text-ember')}>
                {hero.title}
              </div>
              <div className="mt-[2px] line-clamp-2 break-words text-[12.5px] text-foreground/85">
                {byline}
              </div>
            </div>
            <PlayButton
              size="sm"
              label={currentId === hero.id && isPlaying ? 'Pause' : 'Play these songs'}
              playing={currentId === hero.id && isPlaying}
              onClick={() => activate(hero)}
              className="absolute right-3 bottom-3 z-[2]"
            />
          </div>
          {rows.length > 0 && (
            <ul className="px-row pt-inset pb-cluster">
              {rows.map((t) => (
                <li key={t.id} className="border-t border-border">
                  <button
                    type="button"
                    onClick={() => activate(t)}
                    className="flex w-full min-w-0 items-center gap-[10px] py-[7px] text-left"
                  >
                    <Artwork src={t.artworkUrl} loading="lazy" className="size-[34px] shrink-0 rounded-[4px] bg-art" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px] font-semibold', currentId === t.id ? 'text-ember' : 'text-foreground')}>
                        {t.title}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{t.artist}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
