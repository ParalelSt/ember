'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CloseIcon, GridIcon, ListIcon, SearchIcon, SortIcon } from '@/components/icons';
import { Avatar } from '@/components/primitives/Avatar';
import { LibraryAddMenu } from '@/components/library/LibraryAddMenu';
import { LibraryEmptyCard } from '@/components/library/LibraryEmptyCard';
import { LibraryItemRow } from '@/components/library/LibraryItemRow';
import {
  arrangeLibrary,
  libraryChips,
  nextChip,
  type LibraryChip,
  type LibraryItem,
  type LibrarySort,
  type LibraryView,
} from '@/lib/library';
import { cn } from '@/lib/utils';

export interface PhoneLibraryProps {
  /** Every item (lib/library buildLibraryItems), before chip, search and sort. */
  items: LibraryItem[];
  /** False shows the "Create your first playlist" card. */
  hasPlaylists: boolean;
  profile: { name?: string | null; email?: string | null; avatarUrl?: string | null };
  /** List or grid, remembered per device by the page (useLibraryView). */
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  /** A carlist is live for you: the + menu's carlist item opens it. */
  carlistLive: boolean;
  /** A playlist row was tapped (it moves up Recents). */
  onOpenPlaylist: (id: string) => void;
  onNewPlaylist: () => void;
  onCarlist: () => void;
  onImport: () => void;
  /** The empty card's "Import from Spotify or YouTube" link. */
  importPlaylistHref: string;
}

/** Presentational only: the phone Library (below md), from the owner's
 *  picks. The Spotify header (avatar, Your Library, search, +), sticky
 *  filter chips, a Recents / Alphabetical sort with a list or grid toggle,
 *  then one list where Liked songs, Recently played, Uploads and Downloaded
 *  come first, then the playlists. The chip, sort and search are this
 *  page's own passing state; the data and the flows come in as props. */
export function PhoneLibrary({
  items: all,
  hasPlaylists,
  profile,
  view,
  onViewChange,
  carlistLive,
  onOpenPlaylist,
  onNewPlaylist,
  onCarlist,
  onImport,
  importPlaylistHref,
}: PhoneLibraryProps) {
  const [chip, setChip] = useState<LibraryChip | null>(null);
  const [sort, setSort] = useState<LibrarySort>('recents');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const items = arrangeLibrary(all, { chip, sort, query: searchOpen ? query : '' });
  const chips = libraryChips(all.some((i) => i.kind === 'mix'));
  const searching = searchOpen && !!query.trim();
  const showEmpty = !hasPlaylists && (chip === null || chip === 'playlists') && !searching;

  const activate = (item: LibraryItem) => {
    if (item.kind === 'downloaded') setChip('downloaded');
    else if (item.playlistId) onOpenPlaylist(item.playlistId);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  return (
    <div data-phone-library>
      <header className="flex h-[52px] items-center gap-row">
        <Link href="/settings/profile" aria-label="Profile and settings" className="shrink-0 rounded-full">
          <Avatar
            src={profile.avatarUrl}
            name={profile.name}
            email={profile.email}
            className="size-[34px] bg-ember text-sm font-extrabold text-ember-foreground"
          />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold tracking-[-0.02em]">Your Library</h1>
        <div className="flex shrink-0 items-center gap-[6px]">
          <button
            type="button"
            aria-label="Search your library"
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className="grid size-[38px] place-items-center rounded-full transition-colors hover:bg-secondary aria-pressed:bg-secondary"
          >
            <SearchIcon className="size-6" />
          </button>
          <LibraryAddMenu carlistLive={carlistLive} onNewPlaylist={onNewPlaylist} onCarlist={onCarlist} onImport={onImport} />
        </div>
      </header>

      {searchOpen && (
        <div className="mb-cluster flex items-center gap-cluster rounded-full bg-secondary px-row">
          <SearchIcon aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
            placeholder="Search Your Library"
            aria-label="Search Your Library"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <button type="button" aria-label="Close search" onClick={closeSearch} className="grid size-8 place-items-center text-muted-foreground">
            <CloseIcon className="size-[18px]" />
          </button>
        </div>
      )}

      <div
        role="toolbar"
        aria-label="Filter your library"
        data-library-chips
        className="sticky top-0 z-10 -mx-page flex gap-cluster overflow-x-auto bg-background px-page pt-inset pb-[10px] scrollbar-none"
      >
        {chips.map((c) => {
          const on = c.id === chip;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChip(nextChip(chip, c.id))}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-[14px] py-[7px] text-[13px] font-semibold transition-colors',
                on ? 'bg-ember text-ember-foreground' : 'bg-secondary text-foreground hover:bg-accent',
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="mt-inset mb-cluster flex items-center justify-between text-[13px] font-semibold">
        <button
          type="button"
          data-testid="library-sort"
          aria-label={`Sorted by ${sort === 'recents' ? 'Recents' : 'Alphabetical'}, tap to change`}
          onClick={() => setSort(sort === 'recents' ? 'alpha' : 'recents')}
          className="flex items-center gap-[6px] py-[6px]"
        >
          <SortIcon aria-hidden className="size-[18px]" />
          {sort === 'recents' ? 'Recents' : 'Alphabetical'}
        </button>
        <button
          type="button"
          data-testid="library-view"
          aria-label={view === 'list' ? 'Show as grid' : 'Show as list'}
          onClick={() => onViewChange(view === 'list' ? 'grid' : 'list')}
          className="grid size-8 place-items-center"
        >
          {view === 'list' ? <GridIcon className="size-[18px]" /> : <ListIcon className="size-[18px]" />}
        </button>
      </div>

      {items.length > 0 &&
        (view === 'grid' ? (
          <div data-library-view="grid" className="grid grid-cols-2 gap-x-row gap-y-block">
            {items.map((item) => (
              <LibraryItemRow key={item.key} item={item} variant="tile" onActivate={activate} />
            ))}
          </div>
        ) : (
          <div data-library-view="list">
            {items.map((item) => (
              <LibraryItemRow key={item.key} item={item} onActivate={activate} />
            ))}
          </div>
        ))}

      {showEmpty ? (
        <LibraryEmptyCard onCreate={onNewPlaylist} importHref={importPlaylistHref} />
      ) : (
        items.length === 0 && (
          <p className="py-[34px] text-center text-[15px] text-muted-foreground">
            {searching ? `Nothing in your library matches "${query.trim()}"` : 'Nothing here yet'}
          </p>
        )
      )}
    </div>
  );
}
