import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import { RowHeader } from '@/components/page/RowShelf';
import { Skeleton } from '@/components/ui/skeleton';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

/** The big card plus this many songs listed under it. */
export const HERO_SONGS = 3;

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
}: BecauseYouPlayedProps) {
  if (!loading && tracks.length === 0) return null;
  const [hero, ...rest] = tracks;
  const rows = rest.slice(0, HERO_SONGS);
  const shown = 1 + rows.length;
  const activate = (t: Track) => (currentId === t.id ? onToggle() : onPlay(t, tracks));

  return (
    <section aria-label={title} className="mb-section">
      <RowHeader title={title} showAllHref={tracks.length > shown ? showAllHref : undefined} />
      {!hero ? (
        <Skeleton data-testid="hero-skeleton" className="h-[178px] w-full rounded-[14px]" />
      ) : (
        <div data-hero className="overflow-hidden rounded-[14px] bg-card">
          <div className="relative flex h-[178px] items-end p-3">
            <Artwork src={hero.artworkUrl} fallback="gradient" className="absolute inset-0 bg-art" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-black/80" />
            <div className="relative z-[1] min-w-0 pr-12 text-white">
              <div className={cn('line-clamp-2 break-words text-[19px] font-bold leading-tight', currentId === hero.id && 'text-ember')}>
                {hero.title}
              </div>
              <div className="mt-0.5 line-clamp-2 break-words text-[12.5px] text-white/85">
                {seedArtist ? `${hero.artist} · More like ${seedArtist}` : hero.artist}
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
            <ul className="px-3 pt-1 pb-2">
              {rows.map((t) => (
                <li key={t.id} className="border-t border-border">
                  <button
                    type="button"
                    onClick={() => activate(t)}
                    className="flex w-full min-w-0 items-center gap-2.5 py-[7px] text-left"
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
