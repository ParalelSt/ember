import Link from 'next/link';
import { CheckIcon } from '@/components/icons';
import { CollectionCover, type CollectionCoverProps } from '@/components/library/CollectionCover';
import { cn } from '@/lib/utils';

export interface CollectionCardProps {
  title: string;
  subtitle: string;
  href: string;
  cover: CollectionCoverProps;
  badge?: 'downloaded';
  size: 'md' | 'lg';
}

/** Presentational only: no data fetching, no store reads. One tile in a
 *  CollectionShelf, for a system collection or a playlist alike. */
export function CollectionCard({ title, subtitle, href, cover, badge, size }: CollectionCardProps) {
  return (
    <Link href={href} className="group block p-4 rounded-md bg-card hover:bg-card/80 transition-colors">
      <CollectionCover {...cover} />
      <div className="mt-3 flex items-center gap-1.5">
        {badge === 'downloaded' && <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />}
        <div className={cn('truncate font-semibold', size === 'lg' ? 'text-base' : 'text-sm')}>{title}</div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
    </Link>
  );
}
