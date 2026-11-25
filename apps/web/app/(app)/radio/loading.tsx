import { newLookOnly, ShelfSkeleton, TitleSkeleton } from '@/components/page/NavLoading';
import { Skeleton } from '@/components/ui/skeleton';

/** Radio while its chunk and the host answer: the title, the station search
 *  box, and the favourites and nearby shelves. */
export default async function RadioLoading() {
  return newLookOnly(
    <div data-testid="radio-loading">
      <TitleSkeleton className="h-8 w-28 mb-block" />
      <Skeleton className="h-11 max-w-xl w-full rounded-full mb-section" />
      <ShelfSkeleton />
      <ShelfSkeleton />
    </div>,
  );
}
