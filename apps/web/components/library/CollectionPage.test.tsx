import { useState, type ComponentProps, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CollectionPage, type CollectionPageProps, type CollectionSelectionHandle } from './CollectionPage';
import { DEFAULT_PLAYLIST_SORT, sortCollection, type SortState } from '@/lib/playlistCopy';
import type { Track } from '@/types/track';

// The ⋯ menu and the sort menu: a dropdown on desktop, a sheet on a phone.
vi.mock('@/components/ui/dropdown-menu', () => import('@/test-utils/dropdownMenuMock'));
const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function track(id: string, title: string, artist = 'Aftertone'): Track {
  return {
    id: `t:${id}`,
    source: 'youtube',
    sourceId: id,
    title,
    artist,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '',
  };
}

const noop = () => {};

function props(over: Partial<CollectionPageProps> = {}): CollectionPageProps {
  return {
    eyebrow: 'Playlist',
    title: 'Liked songs',
    meta: ['2 songs'],
    cover: { src: null, icon: 'heart' },
    tracks: [track('a', 'Slow Static'), track('b', 'Harbor Lights')],
    context: { type: 'liked' },
    playback: { play: noop, shuffle: noop, shuffleOn: false, active: false },
    download: null,
    trackActions: { currentId: null, isPlaying: false, likedIds: new Set(), onPlay: noop, onToggle: noop },
    emptyMessage: 'No liked songs yet.',
    ...over,
  };
}

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('CollectionPage', () => {
  it('stacks header, action bar and list in that order', () => {
    render(<CollectionPage {...props()} />);
    const header = screen.getByTestId('collection-header');
    const meta = screen.getByTestId('collection-meta');
    const bar = screen.getByTestId('action-bar');
    const firstRow = screen.getByText('Slow Static');

    expect(follows(meta, bar)).toBe(true);
    expect(follows(bar, firstRow)).toBe(true);
    // Beside: the action bar lives inside the header's text column.
    expect(header.contains(bar)).toBe(false);
    expect(header.contains(firstRow)).toBe(false);
    expect(follows(screen.getByText('Slow Static'), screen.getByText('Harbor Lights'))).toBe(true);
  });

  it('puts a stack gap between the header and the list, with no margins on either', () => {
    render(<CollectionPage {...props()} />);
    const header = screen.getByTestId('collection-header');
    const stack = header.parentElement!;
    expect(stack.className).toContain('gap-stack');
    expect(stack.className).toContain('flex-col');
    expect(stack.children).toHaveLength(3);
    expect(stack.children[0]).toBe(header);
    expect(stack.children[2].contains(screen.getByText('Slow Static'))).toBe(true);
    expect(screen.getByTestId('action-bar').className).toContain('gap-cluster');
    expect(screen.getByTestId('action-bar').className).not.toMatch(/(^|\s)m[tbxy]?-/);
  });

  it('puts a block under the title (the "Shared by" badge) in the header', () => {
    render(<CollectionPage {...props({ belowTitle: <span data-testid="under-title">Shared by Olga</span> })} />);
    expect(within(screen.getByTestId('collection-header')).getByTestId('under-title')).toBeInTheDocument();
  });

  it('keeps the page children after the stack', () => {
    render(
      <CollectionPage {...props()}>
        <div>Add songs</div>
      </CollectionPage>,
    );
    const stack = screen.getByTestId('collection-header').parentElement!;
    expect(follows(stack, screen.getByText('Add songs'))).toBe(true);
    expect(stack.contains(screen.getByText('Add songs'))).toBe(false);
  });

  it('shows the empty state where the list goes', () => {
    render(<CollectionPage {...props({ tracks: [] })} />);
    expect(follows(screen.getByTestId('action-bar'), screen.getByText('No liked songs yet.'))).toBe(true);
  });

  it('drops the action bar entirely when there is nothing to put in it', () => {
    render(<CollectionPage {...props({ tracks: [], hideActions: true })} />);
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });

  it('keeps Play and Shuffle wired', () => {
    const play = vi.fn();
    const shuffle = vi.fn();
    render(<CollectionPage {...props({ playback: { play, shuffle, shuffleOn: false, active: false } })} />);
    within(screen.getByTestId('action-bar')).getByRole('button', { name: 'Play' }).click();
    screen.getByRole('button', { name: 'Shuffle play' }).click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(shuffle).toHaveBeenCalledTimes(1);
  });

  it('draws Shuffle as a soft circle that gets a thin Ember border while on', () => {
    const { rerender } = render(<CollectionPage {...props()} />);
    const off = screen.getByRole('button', { name: 'Shuffle play' });
    expect(off).toHaveClass('size-12', 'rounded-full', 'bg-secondary', 'border-transparent');
    expect(off).not.toHaveClass('border-ember');
    rerender(<CollectionPage {...props({ playback: { play: noop, shuffle: noop, shuffleOn: true, active: true } })} />);
    const on = screen.getByRole('button', { name: 'Shuffle off' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('border-ember', 'text-ember');
  });
});

/** The page's wiring, with plain state standing in for useTrackSelection
 *  and useCollectionSort (a presentational test does not import hooks/). */
function SelectablePage({ tracks, onCopyBar = () => null, over = {} }: {
  tracks: Track[];
  onCopyBar?: (picked: Track[]) => ReactNode;
  over?: Partial<CollectionPageProps>;
}) {
  const DEFAULT: SortState = { key: 'added', dir: 'asc' };
  const [sort, setSort] = useState<SortState>(DEFAULT);
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const sorted = sortCollection(tracks, sort, DEFAULT);
  const picked = sorted.filter((t) => ids.includes(t.id));
  const all = picked.length === sorted.length;
  const selection: CollectionSelectionHandle = {
    selecting,
    enter: () => setSelecting(true),
    exit: () => {
      setSelecting(false);
      setIds([]);
    },
    isSelected: (id) => ids.includes(id),
    toggle: (id) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    toggleAll: () => setIds(all ? [] : sorted.map((t) => t.id)),
    count: picked.length,
    total: sorted.length,
    allState: picked.length === 0 ? false : all ? true : 'mixed',
  };
  return (
    <CollectionPage
      {...props({ tracks: sorted, ...over })}
      sort={{ value: sort, onChange: setSort }}
      selection={selection}
      addedLabel={(t) => `added ${t.title}`}
      selectionBar={selecting ? <div data-testid="bar">{onCopyBar(picked)}{picked.length} selected</div> : null}
    />
  );
}

const titles = () => screen.getAllByTestId('track-row-title').map((el) => el.textContent);

/** Select mode's door: Copy songs to… in the ⋯ menu. */
function enterSelect() {
  fireEvent.click(screen.getByTestId('more-menu'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy songs to…' }));
}

describe('CollectionPage select mode and sort', () => {
  const list = [track('a', 'beta', 'Zed'), track('b', 'Alpha', 'Amy'), track('c', 'Gamma', 'Bo')];

  it('no Select button: Copy songs to… in the ⋯ menu turns the play column into tick boxes', () => {
    render(<SelectablePage tracks={list} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTestId('select-toggle')).toBeNull();
    expect(within(screen.getByTestId('action-bar')).queryByRole('button', { name: /^Select/ })).toBeNull();
    enterSelect();
    const toggle = within(screen.getByTestId('action-bar')).getByTestId('select-toggle');
    expect(toggle).toHaveTextContent('Done');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The ⋯ steps aside for the Done pill.
    expect(screen.queryByTestId('more-menu')).toBeNull();
    const boxes = screen.getAllByRole('checkbox', { name: /^Select (beta|Alpha|Gamma)$/ });
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
    // No play buttons while selecting.
    expect(screen.queryAllByRole('button', { name: 'Play' }).filter((b) => !screen.getByTestId('action-bar').contains(b))).toHaveLength(0);
  });

  it('a tick box and a click on the row both toggle; the count and the bar follow', () => {
    render(<SelectablePage tracks={list} />);
    enterSelect();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Gamma'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('2 of 3');
    expect(screen.getByTestId('bar')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('select-all-box')).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(screen.getByText('Gamma'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('1 of 3');
  });

  it('Select all picks every song, then clears them; Done leaves select mode', () => {
    render(<SelectablePage tracks={list} />);
    enterSelect();
    fireEvent.click(screen.getByTestId('select-all'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('3 of 3');
    expect(screen.getByTestId('select-all')).toHaveTextContent('Clear all');
    expect(screen.getByTestId('select-all-box')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('select-all'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('0 of 3');
    fireEvent.click(screen.getByTestId('select-toggle'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTestId('bar')).toBeNull();
    expect(screen.queryByTestId('select-toggle')).toBeNull();
    expect(screen.getByTestId('more-menu')).toBeInTheDocument();
  });

  it('outside select mode a single click still plays and the row menu is there', () => {
    const onPlay = vi.fn();
    render(
      <SelectablePage
        tracks={list}
        over={{
          trackActions: { currentId: null, isPlaying: false, likedIds: new Set(), onPlay, onToggle: noop },
          trailing: (t) => <button type="button">More {t.title}</button>,
        }}
      />,
    );
    fireEvent.click(screen.getAllByTestId('track-row')[0]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'More beta' })).toBeInTheDocument();
    enterSelect();
    fireEvent.click(screen.getAllByTestId('track-row')[0]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    // The menu gives way to the date added.
    expect(screen.queryByRole('button', { name: 'More beta' })).toBeNull();
    expect(screen.getAllByTestId('track-row-added')[0]).toHaveTextContent('added beta');
  });

  it('Sort is a simple list: another key starts at its natural way, the one in use flips; the selection survives it', () => {
    render(<SelectablePage tracks={list} />);
    expect(titles()).toEqual(['beta', 'Alpha', 'Gamma']);
    const pick = (label: string) => {
      fireEvent.click(screen.getByTestId('sort-button'));
      fireEvent.click(within(screen.getByTestId('sort-menu')).getByRole('menuitem', { name: new RegExp(`^${label}`) }));
    };
    fireEvent.click(screen.getByTestId('sort-button'));
    const items = within(screen.getByTestId('sort-menu')).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Title', 'Artist', 'Date added, Oldest first', 'Duration']);
    // The one in use: highlighted, with its arrow.
    expect(screen.getByTestId('sort-added')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sort-added').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('sort-title')).not.toHaveAttribute('data-active');
    fireEvent.click(screen.getByTestId('sort-button'));

    pick('Title');
    expect(titles()).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sort: Title, A to Z');
    pick('Title');
    expect(titles()).toEqual(['Gamma', 'beta', 'Alpha']);
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sort: Title, Z to A');
    pick('Artist');
    expect(titles()).toEqual(['Alpha', 'Gamma', 'beta']);
    enterSelect();
    fireEvent.click(screen.getByText('beta'));
    pick('Artist');
    expect(titles()).toEqual(['beta', 'Gamma', 'Alpha']);
    expect(screen.getByRole('checkbox', { name: 'Select beta' })).toHaveAttribute('aria-checked', 'true');
    pick('Date added');
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sort: Date added, Newest first');
  });

  it('on a phone the sort list is a sheet from the bottom', () => {
    screenSize.desktop = false;
    try {
      render(<SelectablePage tracks={list} />);
      fireEvent.click(screen.getByTestId('sort-button'));
      const sheet = screen.getByTestId('sort-menu');
      expect(within(sheet).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Title',
        'Artist',
        'Date added, Oldest first',
        'Duration',
      ]);
      fireEvent.click(screen.getByTestId('sort-duration'));
      expect(screen.queryByTestId('sort-menu')).toBeNull();
      expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sort: Duration, Shortest first');
    } finally {
      screenSize.desktop = true;
    }
  });

  it('no "N songs" line under the action bar: Sort sits at its right end, after the ⋯', () => {
    render(<SelectablePage tracks={list} over={{ actions: <a href="/transfer">Transfer</a> }} />);
    expect(screen.queryByTestId('list-toolbar')).toBeNull();
    expect(screen.queryByText('3 songs')).toBeNull();
    const bar = screen.getByTestId('action-bar');
    const sortButton = within(bar).getByTestId('sort-button');
    expect(sortButton.parentElement).toHaveClass('ml-auto');
    expect(bar.lastElementChild).toBe(sortButton.parentElement);
    // Transfer, then the ⋯, then Sort.
    const transfer = within(bar).getByRole('link', { name: 'Transfer' });
    const more = within(bar).getByTestId('more-menu');
    expect(follows(transfer, more)).toBe(true);
    expect(follows(more, sortButton)).toBe(true);
  });

  it('no Copy songs and no Sort over an import list or an empty collection', () => {
    const { unmount } = render(<SelectablePage tracks={list} over={{ list: <div>import rows</div> }} />);
    expect(screen.queryByTestId('more-menu')).toBeNull();
    expect(screen.queryByTestId('sort-button')).toBeNull();
    expect(screen.queryByTestId('list-toolbar')).toBeNull();
    unmount();
    render(<SelectablePage tracks={[]} />);
    expect(screen.queryByTestId('more-menu')).toBeNull();
    expect(screen.queryByTestId('sort-button')).toBeNull();
  });

  it('the page\'s own rows follow Copy songs to… in the same ⋯ menu', () => {
    const onRename = vi.fn();
    render(
      <SelectablePage
        tracks={list}
        over={{
          moreActions: [{ key: 'rename', label: 'Rename', icon: () => null, onSelect: onRename }],
          moreLabel: 'Playlist options',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Playlist options' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Copy songs to…', 'Rename']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionPage Edit order', () => {
  const list = [track('a', 'One'), track('b', 'Two')];
  const reorder = (over: Partial<NonNullable<CollectionPageProps['reorder']>> = {}) => ({
    editing: false,
    tracks: list,
    onStart: vi.fn(),
    onDone: vi.fn(),
    onMove: vi.fn(),
    ...over,
  });

  it('Edit order in the ⋯ menu for someone who can edit', () => {
    const r = reorder();
    render(<CollectionPage {...props({ tracks: list, reorder: r })} />);
    expect(screen.queryByTestId('list-toolbar')).toBeNull();
    fireEvent.click(screen.getByTestId('more-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit order' }));
    expect(r.onStart).toHaveBeenCalled();
    expect(screen.queryByTestId('reorder-list')).toBeNull();
  });

  it('no Edit order without the prop (someone who cannot edit, or not a playlist)', () => {
    render(<CollectionPage {...props({ tracks: list })} />);
    expect(screen.queryByTestId('more-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit order' })).toBeNull();
  });

  it('editing: the arrows-and-handles list, Done saves; no Sort, no Select, no hearts', () => {
    const r = reorder({ editing: true });
    const selection = {
      selecting: false, enter: vi.fn(), exit: vi.fn(), isSelected: () => false, toggle: vi.fn(), toggleAll: vi.fn(), count: 0, total: 2, allState: false as const,
    };
    render(
      <CollectionPage
        {...props({ tracks: list, reorder: r, selection, sort: { value: DEFAULT_PLAYLIST_SORT, onChange: vi.fn() } })}
      />,
    );
    expect(screen.getByTestId('reorder-list')).toBeInTheDocument();
    expect(screen.queryAllByTestId('track-row-title')).toHaveLength(0);
    expect(screen.queryByTestId('select-toggle')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sort/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move One down' }));
    expect(r.onMove).toHaveBeenCalledWith(0, 1);
    fireEvent.click(within(screen.getByTestId('list-toolbar')).getByRole('button', { name: 'Done' }));
    expect(r.onDone).toHaveBeenCalled();
  });

  it('no Edit order while selecting', () => {
    const selection = {
      selecting: true, enter: vi.fn(), exit: vi.fn(), isSelected: () => false, toggle: vi.fn(), toggleAll: vi.fn(), count: 0, total: 2, allState: false as const,
    };
    render(<CollectionPage {...props({ tracks: list, reorder: reorder(), selection })} />);
    expect(screen.queryByTestId('more-menu')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit order' })).toBeNull();
  });
});

describe('CollectionPage empty state', () => {
  it('stays a plain line without `empty`', () => {
    render(<CollectionPage {...props({ tracks: [] })} />);
    expect(screen.getByText('No liked songs yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-icon')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Find songs' })).toBeNull();
  });

  it('with `empty`, shows the icon, title, sentence and next step', () => {
    render(
      <CollectionPage
        {...props({
          tracks: [],
          emptyMessage: 'Tap the heart.',
          empty: { icon: <svg />, title: 'Nothing liked yet', action: { label: 'Find songs', href: '/search' } },
        })}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing liked yet' })).toBeInTheDocument();
    expect(screen.getByText('Tap the heart.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find songs' })).toHaveAttribute('href', '/search');
  });

  it('with songs, shows none of it', () => {
    render(<CollectionPage {...props({ empty: { icon: <svg />, title: 'Nothing liked yet' } })} />);
    expect(screen.queryByRole('heading', { name: 'Nothing liked yet' })).toBeNull();
  });
});
