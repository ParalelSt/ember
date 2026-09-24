import { useState, type ComponentProps, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CollectionPage, type CollectionPageProps, type CollectionSelectionHandle } from './CollectionPage';
import { sortCollection, type SortState } from '@/lib/playlistCopy';
import type { Track } from '@/types/track';

// base-ui's Popover can't render under vitest here (test-utils/popoverMock.tsx).
vi.mock('@base-ui/react/popover', () => import('@/test-utils/popoverMock'));

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
    expect(header.contains(bar)).toBe(true);
    expect(header.contains(firstRow)).toBe(false);
    expect(follows(screen.getByText('Slow Static'), screen.getByText('Harbor Lights'))).toBe(true);
  });

  it('puts a stack gap between the header and the list, with no margins on either', () => {
    render(<CollectionPage {...props()} />);
    const header = screen.getByTestId('collection-header');
    const stack = header.parentElement!;
    expect(stack.className).toContain('gap-stack');
    expect(stack.className).toContain('flex-col');
    expect(stack.children).toHaveLength(2);
    expect(stack.children[0]).toBe(header);
    expect(stack.children[1].contains(screen.getByText('Slow Static'))).toBe(true);
    expect(screen.getByTestId('action-bar').className).toContain('gap-cluster');
    expect(screen.getByTestId('action-bar').className).not.toMatch(/(^|\s)m[tbxy]?-/);
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

describe('CollectionPage select mode and sort', () => {
  const list = [track('a', 'beta', 'Zed'), track('b', 'Alpha', 'Amy'), track('c', 'Gamma', 'Bo')];

  it('Select in the action bar turns the play column into tick boxes', () => {
    render(<SelectablePage tracks={list} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const toggle = within(screen.getByTestId('action-bar')).getByTestId('select-toggle');
    expect(toggle).toHaveTextContent('Select');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Done');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const boxes = screen.getAllByRole('checkbox', { name: /^Select (beta|Alpha|Gamma)$/ });
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
    // No play buttons while selecting.
    expect(screen.queryAllByRole('button', { name: 'Play' }).filter((b) => !screen.getByTestId('action-bar').contains(b))).toHaveLength(0);
  });

  it('a tick box and a click on the row both toggle; the count and the bar follow', () => {
    render(<SelectablePage tracks={list} />);
    fireEvent.click(screen.getByTestId('select-toggle'));
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
    fireEvent.click(screen.getByTestId('select-toggle'));
    fireEvent.click(screen.getByTestId('select-all'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('3 of 3');
    expect(screen.getByTestId('select-all')).toHaveTextContent('Clear all');
    expect(screen.getByTestId('select-all-box')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('select-all'));
    expect(screen.getByTestId('select-count')).toHaveTextContent('0 of 3');
    fireEvent.click(screen.getByTestId('select-toggle'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTestId('bar')).toBeNull();
  });

  it('outside select mode a double click still plays and the row menu is there', () => {
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
    fireEvent.doubleClick(screen.getAllByTestId('track-row')[0]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'More beta' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('select-toggle'));
    fireEvent.doubleClick(screen.getAllByTestId('track-row')[0]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    // The menu gives way to the date added.
    expect(screen.queryByRole('button', { name: 'More beta' })).toBeNull();
    expect(screen.getAllByTestId('track-row-added')[0]).toHaveTextContent('added beta');
  });

  it('Sort works outside select mode: every key, both ways, and the selection survives it', () => {
    render(<SelectablePage tracks={list} />);
    expect(titles()).toEqual(['beta', 'Alpha', 'Gamma']);
    const pick = (label: string) => {
      fireEvent.click(screen.getByTestId('sort-button'));
      fireEvent.click(within(screen.getByTestId('sort-menu')).getByRole('button', { name: label }));
    };
    pick('Title, A to Z');
    expect(titles()).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(screen.getByTestId('sort-button')).toHaveAccessibleName('Sort: Title, A to Z');
    pick('Title, Z to A');
    expect(titles()).toEqual(['Gamma', 'beta', 'Alpha']);
    pick('Artist, A to Z');
    expect(titles()).toEqual(['Alpha', 'Gamma', 'beta']);
    fireEvent.click(screen.getByTestId('select-toggle'));
    fireEvent.click(screen.getByText('beta'));
    pick('Artist, Z to A');
    expect(titles()).toEqual(['beta', 'Gamma', 'Alpha']);
    expect(screen.getByRole('checkbox', { name: 'Select beta' })).toHaveAttribute('aria-checked', 'true');
  });

  it('no Select and no Sort over an import list or an empty collection', () => {
    const { unmount } = render(<SelectablePage tracks={list} over={{ list: <div>import rows</div> }} />);
    expect(screen.queryByTestId('select-toggle')).toBeNull();
    expect(screen.queryByTestId('list-toolbar')).toBeNull();
    unmount();
    render(<SelectablePage tracks={[]} />);
    expect(screen.queryByTestId('select-toggle')).toBeNull();
  });
});
