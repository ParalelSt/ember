import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** The new look's loading.tsx body, or nothing on a device on the Classic
 *  look (docs/classic-look.md): those pages have no skeleton of their own and
 *  the Classic look is frozen, so it keeps its old behaviour (the nav still
 *  lights the tapped item at once, lib/pendingNav). */
export async function newLookOnly(node: ReactNode): Promise<ReactNode> {
  return (await serverUiMode()) === 'legacy' ? null : node;
}

/** A page title bar. */
export function TitleSkeleton({ className }: { className?: string }) {
  return <Skeleton className={className ?? 'h-8 w-40 mb-stack'} />;
}

/** A shelf: a heading and a row of cover cards (Home, Radio). */
export function ShelfSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mb-section" data-testid="shelf-skeleton">
      <Skeleton className="h-5 w-44 mb-block" />
      <div className="flex gap-block overflow-hidden">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="flex w-[140px] shrink-0 flex-col gap-cluster md:w-[180px]">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A plain list of rows (Settings, What's new). */
export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-row" data-testid="rows-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-row py-cluster">
          <Skeleton className="size-10 rounded-md shrink-0" />
          <div className="flex flex-col gap-cluster flex-1 min-w-0 max-w-xl">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
