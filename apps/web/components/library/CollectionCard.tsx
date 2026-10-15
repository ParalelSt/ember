import Link from 'next/link';
import { CheckIcon, PeopleIcon } from '@/components/icons';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionCover, type CollectionCoverProps } from '@/components/primitives/CollectionCover';
import { SharedByBadge } from '@/components/library/SharedByBadge';
import type { PlaylistPerson } from '@/types/track';
import { cn } from '@/lib/utils';

export interface CollectionCardProps {
  title: string;
  subtitle: string;
  href: string;
  cover: CollectionCoverProps;
  badge?: 'downloaded';
  /** A collaborative playlist (yours or shared with you): a small people
   *  mark before the title. The subtitle says whose it is. */
  shared?: boolean;
  /** A playlist shared with you: a "Shared by <owner>" pill with their
   *  face takes the people mark's and the subtitle's place. */
  sharedBy?: Pick<PlaylistPerson, 'name' | 'avatarUrl'>;
  size: 'md' | 'lg';
  /** 'card' (default): the boxed Library card. 'tile': the phone Home
   *  row's bare tile, cover on top, a two-line title and one muted line.
   *  'tile-lg': the desktop Home row's tile, bigger type, and with `onPlay`
   *  a play button that slides up over the cover on hover. */
  variant?: 'card' | 'tile' | 'tile-lg';
  /** 'tile-lg' only: play (or pause, while `playing`) the collection. */
  onPlay?: () => void;
  /** This collection is the one playing now: its button stays up, as Pause. */
  playing?: boolean;
}

/** Presentational only: no data fetching, no store reads. One tile in a
 *  CollectionShelf, for a system collection or a playlist alike. */
export function CollectionCard({ title, subtitle, href, cover, badge, shared, sharedBy, size, variant = 'card', onPlay, playing = false }: CollectionCardProps) {
  if (variant === 'tile-lg') {
    return (
      <div className="group min-w-0">
        {/* The cover opens the collection too, but only the name is in the
            tab order and the accessible tree: one stop per tile. The play
            button sits beside the link, never inside it. */}
        <div className="relative">
          <Link href={href} tabIndex={-1} aria-hidden className="block">
            <CollectionCover {...cover} className={cn('w-full rounded-[8px] shadow-none', cover.className)} />
          </Link>
          {onPlay && (
            <PlayButton
              size="sm"
              label={playing ? 'Pause' : `Play ${title}`}
              playing={playing}
              onClick={onPlay}
              className={cn(
                'absolute right-2 bottom-2 shadow-soft transition-[opacity,translate]',
                playing
                  ? 'opacity-100'
                  : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100',
              )}
            />
          )}
        </div>
        <Link href={href} className="mt-cluster block min-w-0 line-clamp-2 break-words text-[15px] font-bold leading-snug hover:underline">
          {badge === 'downloaded' && <CheckIcon className="mr-1 inline size-3.5 align-[-2px] text-ember" />}
          {shared && !sharedBy && <PeopleIcon data-testid="shared-badge" aria-label="Shared" className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" />}
          {title}
        </Link>
        <div className="mt-inset truncate text-[13px] text-muted-foreground">{subtitle}</div>
      </div>
    );
  }
  if (variant === 'tile') {
    return (
      <Link href={href} className="group block min-w-0">
        <CollectionCover {...cover} className={cn('w-full rounded-[8px] shadow-none', cover.className)} />
        {/* The marks sit inline before the name, so they wrap and clamp
            with it instead of taking a column of their own. */}
        <div className="mt-cluster min-w-0 line-clamp-2 break-words text-sm font-bold leading-snug">
          {badge === 'downloaded' && <CheckIcon className="mr-1 inline size-3.5 align-[-2px] text-ember" />}
          {shared && !sharedBy && <PeopleIcon data-testid="shared-badge" aria-label="Shared" className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" />}
          {title}
        </div>
        {/* A shared playlist's subtitle already says whose it is. */}
        <div className="mt-inset truncate text-xs text-muted-foreground">{subtitle}</div>
      </Link>
    );
  }
  return (
    <Link href={href} className="group block p-4 rounded-md bg-card hover:bg-card/80 transition-colors">
      <CollectionCover {...cover} />
      <div className="mt-3 flex items-center gap-1.5">
        {badge === 'downloaded' && <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />}
        {shared && !sharedBy && <PeopleIcon data-testid="shared-badge" aria-label="Shared" className="size-3.5 shrink-0 text-muted-foreground" />}
        <div className={cn('truncate font-semibold', size === 'lg' ? 'text-base' : 'text-sm')}>{title}</div>
      </div>
      {sharedBy ? (
        <SharedByBadge owner={sharedBy} size="sm" className="mt-inset" />
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </Link>
  );
}
