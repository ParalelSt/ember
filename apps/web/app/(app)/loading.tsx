import { Skeleton } from '@/components/ui/skeleton';
import { newLookOnly, ShelfSkeleton, TitleSkeleton } from '@/components/page/NavLoading';

/** Shown the moment a tap leaves for any page under app/(app) that has no
 *  loading.tsx of its own, Home first of all: a greeting bar, the filter
 *  chips and a few shelves, so the old page never sits there looking frozen
 *  while the host answers. Pages with their own loading.tsx (Library,
 *  Search, album...) override it. */
export default async function AppLoading() {
  return newLookOnly(
    <div data-testid="app-loading">
      <TitleSkeleton className="h-8 w-56 mb-block" />
      <div className="mb-stack flex gap-cluster">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
      <ShelfSkeleton />
      <ShelfSkeleton />
    </div>,
  );
}
