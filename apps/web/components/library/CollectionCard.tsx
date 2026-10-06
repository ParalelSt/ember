import Link from 'next/link';
import { CheckIcon, PeopleIcon } from '@/components/icons';
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
}

/** Presentational only: no data fetching, no store reads. One tile in a
 *  CollectionShelf, for a system collection or a playlist alike. */
export function CollectionCard({ title, subtitle, href, cover, badge, shared, sharedBy, size }: CollectionCardProps) {
  return (
    <Link href={href} className="group block p-4 rounded-md bg-card hover:bg-card/80 transition-colors">
      <CollectionCover {...cover} />
      <div className="mt-3 flex items-center gap-1.5">
        {badge === 'downloaded' && <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />}
        {shared && !sharedBy && <PeopleIcon data-testid="shared-badge" aria-label="Shared" className="size-3.5 shrink-0 text-muted-foreground" />}
        <div className={cn('truncate font-semibold', size === 'lg' ? 'text-base' : 'text-sm')}>{title}</div>
      </div>
      {sharedBy ? (
        <SharedByBadge owner={sharedBy} size="sm" className="mt-1" />
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </Link>
  );
}
