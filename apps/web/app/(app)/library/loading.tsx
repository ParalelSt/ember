import { Skeleton } from '@/components/ui/skeleton';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** Shown while /library's own chunk and payload are loading. Mirrors the
 *  real page: title, the row of action buttons, and a shelf of cover cards. */
function NewLibraryLoading() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The new look's loading, or on a device on the Classic look the frozen one
 *  (RULES.md "Classic look"), imported only then. */
export default async function LibraryLoading() {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/library/loading');
    return <Legacy />;
  }
  return NewLibraryLoading();
}
