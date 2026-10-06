import { Avatar } from '@/components/primitives/Avatar';
import { cn } from '@/lib/utils';
import type { PlaylistPerson } from '@/types/track';

/** Presentational only: the "Shared by Olga" pill with Olga's face, on a
 *  playlist someone shared with you (its page header and its library
 *  card). `size` sm is the card's, md the header's. */
export function SharedByBadge({
  owner,
  size = 'md',
  className,
}: {
  owner: Pick<PlaylistPerson, 'name' | 'avatarUrl'>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      data-testid="shared-by"
      className={cn(
        'inline-flex max-w-full items-center gap-cluster rounded-full bg-card font-medium',
        size === 'sm' ? 'py-0.5 pr-cluster pl-0.5 text-xs' : 'py-inset pr-row pl-inset text-sm',
        className,
      )}
    >
      <Avatar
        src={owner.avatarUrl}
        name={owner.name}
        className={cn('bg-ember text-ember-foreground', size === 'sm' ? 'size-4 text-[9px]' : 'size-6 text-[10px]')}
      />
      <span className="truncate">
        Shared by <b className="font-semibold">{owner.name}</b>
      </span>
    </span>
  );
}
