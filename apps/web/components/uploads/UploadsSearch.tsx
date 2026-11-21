'use client';

import { useMemo, useState } from 'react';
import { SearchIcon } from '@/components/icons';
import { ListSearchBox } from '@/components/library/ListSearchBox';
import { EmptyState } from '@/components/page/EmptyState';
import { filterTracks } from '@/lib/listSearch';
import { cn } from '@/lib/utils';
import type { MyUpload } from '@/types/track';

/** Search inside "Your uploads", shared by the phone page and the desktop
 *  section: the same behaviour as a collection page (lib/listSearch). Phone:
 *  a magnifier reveals an underline box above the rows. Desktop: a soft box
 *  is always there. These rows have no select or reorder mode and no play
 *  context, so there is nothing to hide the box for. */
export function useUploadsSearch(uploads: MyUpload[], isDesktop: boolean) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const canSearch = uploads.length > 0;
  const q = canSearch ? query : '';
  const filtering = q.trim() !== '';
  const shown = useMemo(() => filterTracks(uploads, q), [uploads, q]);
  return {
    isDesktop,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    canSearch,
    filtering,
    shown,
    q: q.trim(),
    boxVisible: canSearch && (isDesktop || searchOpen || filtering),
  };
}
export type UploadsSearch = ReturnType<typeof useUploadsSearch>;

/** Phone only: the magnifier in the "Your uploads" header row. */
export function UploadsSearchToggle({ search }: { search: UploadsSearch }) {
  if (!search.canSearch || search.isDesktop) return null;
  const { searchOpen, setSearchOpen, setQuery } = search;
  return (
    <button
      type="button"
      data-testid="list-search-toggle"
      aria-label="Search in this list"
      aria-pressed={searchOpen}
      onClick={() => {
        if (searchOpen) setQuery('');
        setSearchOpen(!searchOpen);
      }}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-transparent bg-secondary text-foreground transition-colors hover:bg-accent',
        searchOpen && 'border-ember text-ember hover:text-ember',
      )}
    >
      <SearchIcon className="h-5 w-5" />
    </button>
  );
}

/** Desktop: the always-visible soft box, right-aligned in the header row. */
export function UploadsSearchDesktopBox({ search }: { search: UploadsSearch }) {
  if (!search.canSearch || !search.isDesktop) return null;
  return <ListSearchBox value={search.query} onChange={search.setQuery} variant="soft" className="w-[260px]" />;
}

/** Phone: the underline box above the rows, once the magnifier opened it. */
export function UploadsSearchPhoneBox({ search }: { search: UploadsSearch }) {
  if (!search.boxVisible || search.isDesktop) return null;
  return (
    <ListSearchBox
      value={search.query}
      onChange={search.setQuery}
      onEscape={() => search.setSearchOpen(false)}
      autoFocus
    />
  );
}

/** `No songs match "<q>"` with Clear, in place of the rows. */
export function UploadsNoMatch({ search }: { search: UploadsSearch }) {
  return (
    <EmptyState action={{ label: 'Clear', onClick: () => search.setQuery('') }}>
      No songs match &ldquo;{search.q}&rdquo;
    </EmptyState>
  );
}
