import type { ReactNode } from 'react';
import { CollectionCover, type CollectionCoverProps } from '@/components/library/CollectionCover';
import { cn } from '@/lib/utils';

export interface CollectionHeaderProps {
  eyebrow: string;
  title: string;
  meta: string[];
  cover: CollectionCoverProps;
  onCoverClick?: () => void;
  coverLabel?: string;
  coverBusy?: boolean;
  children?: ReactNode;
}

/** Presentational only: a collection's title block, shared by the playlist
 *  page and (Task 3) Liked/Recent/Uploads. `children` is the action bar,
 *  which sits beside the cover on desktop (md:flex-row items-end). */
export function CollectionHeader({
  eyebrow,
  title,
  meta,
  cover,
  onCoverClick,
  coverLabel,
  coverBusy,
  children,
}: CollectionHeaderProps) {
  const coverClassName = 'shrink-0 h-44 w-44 md:h-48 md:w-48 rounded-2xl';

  return (
    <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
      {onCoverClick ? (
        <button
          type="button"
          onClick={onCoverClick}
          disabled={coverBusy}
          className={cn(
            'group relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            coverClassName,
          )}
          aria-label={coverLabel}
          title={coverLabel}
        >
          <CollectionCover {...cover} className="h-full w-full rounded-2xl" />
          <span className="absolute inset-0 grid place-items-center bg-black/40 text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            {coverBusy ? 'Uploading…' : 'Change cover'}
          </span>
        </button>
      ) : (
        <div className={cn('relative', coverClassName)}>
          <CollectionCover {...cover} className="h-full w-full rounded-2xl" />
        </div>
      )}
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
        <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight leading-tight">{title}</h1>
        <div className="mt-3 text-sm text-muted-foreground">{meta.join(' · ')}</div>
        {children}
      </div>
    </div>
  );
}
