import { SearchIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';

/** A search that came back with nothing, on the Search page and in the
 *  overlay. The box to try again in is right there, so no button. */
export function SearchNoResults({ query }: { query: string }) {
  return (
    <EmptyState icon={<SearchIcon />} title="No results">
      Nothing matched &quot;{query}&quot;. Check the spelling or try fewer words.
    </EmptyState>
  );
}
