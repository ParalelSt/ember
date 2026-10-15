'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CloseIcon, GridIcon, ListIcon, SearchIcon, SortIcon } from '@/components/icons';
import { Avatar } from '@/components/primitives/Avatar';
import { LibraryAddMenu } from '@/components/library/LibraryAddMenu';
import { LibraryEmptyCard } from '@/components/library/LibraryEmptyCard';
import { LibraryItemRow } from '@/components/library/LibraryItemRow';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { StartSessionDialog } from '@/components/session/SessionDialogs';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCollections } from '@/hooks/useCollections';
import { useCreatePlaylistFlow } from '@/hooks/useCreatePlaylistFlow';
import { useQueryHistory, useQueryLikes, useQueryUploads } from '@/hooks/useLibrary';
import { useNavPlaylists } from '@/hooks/useNavPlaylists';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import {
  arrangeLibrary,
  buildLibraryItems,
  libraryChips,
  nextChip,
  readLibraryView,
  writeLibraryView,
  type LibraryChip,
  type LibraryItem,
  type LibrarySort,
  type LibraryView,
} from '@/lib/library';
import { cn } from '@/lib/utils';

/** Where Import goes: the Transfer flow, with Back returning here. */
export const LIBRARY_IMPORT_HREF = `/transfer?from=${encodeURIComponent('/library')}`;
/** The empty card's import is about playlists, so it starts on that card. */
export const LIBRARY_IMPORT_PLAYLIST_HREF = `/transfer?to=playlist&from=${encodeURIComponent('/library')}`;

/** The phone Library (below md), from the owner's picks: the Spotify
 *  header (avatar, Your Library, search, +), sticky filter chips, a
 *  Recents / Alphabetical sort with a list or grid toggle (remembered per
 *  device), then one list where Liked songs, Recently played, Uploads and
 *  Downloaded come first, then the playlists. */
export function PhoneLibrary() {
  const router = useRouter();
  const { user, name, avatarUrl } = useAuth();
  const { playlists, downloadedIds } = useCollections();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: uploads = [] } = useQueryUploads();
  const { data: carlist } = useQueryLiveCarlist();
  // Recents is the nav's own order: pinned first, then last opened.
  const nav = useNavPlaylists(playlists.map((p) => ({ ...p, id: p.pinId })));

  const [chip, setChip] = useState<LibraryChip | null>(null);
  const [sort, setSort] = useState<LibrarySort>('recents');
  const [view, setView] = useState<LibraryView>('list');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [carlistOpen, setCarlistOpen] = useState(false);
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow();

  // The saved view is read after mounting, so the server's first paint and
  // the client's agree.
  useEffect(() => {
    const saved = readLibraryView();
    if (saved !== 'list') setView(saved);
  }, []);

  const toggleView = () => {
    const next = view === 'list' ? 'grid' : 'list';
    setView(next);
    writeLibraryView(next);
  };

  const all = useMemo(
    () => buildLibraryItems({ liked, history, uploads, playlists: nav.items, downloadedIds }),
    [liked, history, uploads, nav.items, downloadedIds],
  );
  const items = arrangeLibrary(all, { chip, sort, query: searchOpen ? query : '' });
  const chips = libraryChips(all.some((i) => i.kind === 'mix'));
  const noPlaylists = playlists.length === 0;
  const showEmpty = noPlaylists && (chip === null || chip === 'playlists') && !(searchOpen && query.trim());

  const activate = (item: LibraryItem) => {
    if (item.kind === 'downloaded') setChip('downloaded');
    else if (item.playlistId) nav.onOpen(item.playlistId);
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
            src={avatarUrl}
            name={name}
            email={user?.email}
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
          <LibraryAddMenu
            carlistLive={!!carlist}
            onNewPlaylist={() => setCreateOpen(true)}
            onCarlist={() => (carlist ? router.push(`/session/${carlist.id}`) : setCarlistOpen(true))}
            onImport={() => router.push(LIBRARY_IMPORT_HREF)}
          />
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
          onClick={toggleView}
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
        <LibraryEmptyCard onCreate={() => setCreateOpen(true)} importHref={LIBRARY_IMPORT_PLAYLIST_HREF} />
      ) : (
        items.length === 0 && (
          <p className="py-[34px] text-center text-[15px] text-muted-foreground">
            {searchOpen && query.trim() ? `Nothing in your library matches "${query.trim()}"` : 'Nothing here yet'}
          </p>
        )
      )}

      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <StartSessionDialog open={carlistOpen} onOpenChange={setCarlistOpen} />
    </div>
  );
}
