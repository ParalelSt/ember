import { Skeleton } from '@/components/ui/skeleton';

/** Shown for the moment /search's own chunk and payload are loading — the
 *  nav opens the search overlay instantly instead, so this only fires for a
 *  deep link straight to /search. Same shape as the real page: title, the
 *  rounded search-bar pill, and a few row placeholders. */
export default function SearchLoading() {
  return (
    <div className="pt-4 md:pt-0">
      <Skeleton className="h-8 w-32 mb-6" />
      <Skeleton className="h-12 max-w-xl w-full rounded-full" />
      <Skeleton className="h-4 w-24 mt-8 mb-4" />
      <div className="flex flex-col gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-art-sm rounded-md shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0 max-w-xl">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
