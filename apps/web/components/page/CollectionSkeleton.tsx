import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const COVER_CLASS = {
  collection: 'size-art-hero md:size-art-lg rounded-2xl',
  album: 'size-art-hero md:size-art-xl rounded-md',
  artist: 'size-art-hero-sm md:size-art-hero rounded-full',
} as const;

export interface CollectionSkeletonProps {
  variant?: keyof typeof COVER_CLASS;
  /** How many track rows to sketch — kept small; this is a placeholder for
   *  the blank route-load transition, not a guess at the real list length. */
  rows?: number;
}

/** Presentational, no data: a muted stand-in for a collection page's header
 *  (cover + title + meta) and its first few track rows, sized off the same
 *  tokens CollectionHeader and TrackRow use. Used by the route-level
 *  loading.tsx files so a slow connection shows this instead of a blank
 *  screen while the route's chunk and payload arrive — the page's own
 *  "Loading…" text still covers the fetch that happens after it mounts. */
export function CollectionSkeleton({ variant = 'collection', rows = 5 }: CollectionSkeletonProps) {
  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-6">
        <Skeleton className={cn('shrink-0', COVER_CLASS[variant])} />
        <div className="flex flex-col gap-3 min-w-0 w-full max-w-sm">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-art-sm rounded-md shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
