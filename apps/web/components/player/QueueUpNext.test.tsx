/** The queue sheet's Next up: drag handle, keyboard moves, ⋯ menu, Clear and
 *  Shuffle, all against the real player store: what is checked is the queue
 *  the player will really walk through. */
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueueSheet } from './QueueSheet';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { nextIndex } from '@/lib/playback/queueNav';
import { makeTrack } from '@/test-utils/fakeBackend';

const player = vi.hoisted(() => ({ playAt: vi.fn(), playTrack: vi.fn(), playBack: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/ui/dialog', () => import('@/test-utils/dialogMock'));
// The menu itself has its own tests (QueueRowMenu.test): here it lists the
// actions the row hands it.
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ track, actions }: { track: { title: string }; actions?: { key: string; label: string; onSelect: () => void }[] }) => (
    <div role="menu" aria-label={`${track.title} menu`}>
      {actions?.map((a) => (
        <button key={a.key} type="button" role="menuitem" onClick={a.onSelect}>{a.label}</button>
      ))}
    </div>
  ),
}));

const song = (name: string) => makeTrack({ id: `youtube:${name}`, sourceId: name, title: name, artistId: `artist-${name}` });
const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(song);
const ids = () => usePlayerStore.getState().queue.map((t) => t.title);
const shown = () => screen.getAllByTestId('next-up-row').map((r) => within(r).getByTestId('track-row-title').textContent);
const handles = () => screen.getAllByTestId('queue-drag-handle');
const menu = (title: string) => within(screen.getByRole('menu', { name: `${title} menu` }));

const ROW = 40;
/** The rows' places on screen: jsdom has no layout. */
function layOutRows() {
  screen.getAllByTestId('next-up-row').forEach((row, i) => {
    row.getBoundingClientRect = () => ({ top: i * ROW, height: ROW, bottom: (i + 1) * ROW, left: 0, right: 100, width: 100, x: 0, y: i * ROW, toJSON() {} });
  });
}
const press = (i: number, y: number) => fireEvent.pointerDown(handles()[i], { button: 0, pointerId: 1, clientY: y });
const moveTo = (y: number, pointerId = 1) => fireEvent.pointerMove(window, { pointerId, clientY: y });
const release = (pointerId = 1) => fireEvent.pointerUp(window, { pointerId });

function show() {
  render(<QueueSheet open onOpenChange={() => {}} />);
  layOutRows();
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({
    queue: [a, b, c, d, e], index: 1, baseCount: 5, context: null, loopMode: 'off',
    played: [], shuffle: false, orderBackup: null, isPlaying: true, radioHeldFor: null, nowPlayingOpen: false,
  });
});

describe('Next up: dragging a row', () => {
  it('moves the song in the real queue on release, once, and Next follows', () => {
    show();
    press(0, 20); // c, the first row
    const lifted = screen.getAllByTestId('next-up-row')[0];
    expect(lifted).toHaveAttribute('data-dragging', 'true');
    moveTo(110);
    // Under the pointer, the queue not changed yet; the rows it passed make room.
    expect(lifted.style.transform).toBe('translateY(90px)');
    expect(screen.getAllByTestId('next-up-row')[1].style.transform).toBe('translateY(-40px)');
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    release();
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c']);
    expect(shown()).toEqual(['d', 'e', 'c']);
    const st = usePlayerStore.getState();
    expect(st.index).toBe(1);
    expect(st.queue[nextIndex(st)!.index].title).toBe('d');
    // A drag is not a tap on the row it ends over.
    expect(player.playAt).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dragging]')).toBeNull();
  });

  it('moves up too, and a release in the same place changes nothing', () => {
    show();
    press(2, 100); // e
    moveTo(10);
    release();
    expect(ids()).toEqual(['a', 'b', 'e', 'c', 'd']);
    layOutRows();
    const before = usePlayerStore.getState().queue;
    press(1, 60);
    moveTo(62);
    release();
    expect(usePlayerStore.getState().queue).toBe(before);
  });

  it('a pointer cancelled by the system puts the row back', () => {
    show();
    press(0, 20);
    moveTo(100);
    const lifted = screen.getAllByTestId('next-up-row')[0];
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(lifted.style.transform).toBe('');
  });

  it('a second finger neither moves nor drops the drag', () => {
    show();
    press(0, 20);
    moveTo(100, 2);
    release(2);
    expect(screen.getAllByTestId('next-up-row')[0]).toHaveAttribute('data-dragging', 'true');
    press(1, 60); // nor does it start another
    moveTo(110);
    release();
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('the song changing mid-drag drops the drag: nothing moves, and the row is not left floating', () => {
    show();
    press(1, 60); // d
    moveTo(100);
    const lifted = screen.getAllByTestId('next-up-row')[1];
    act(() => usePlayerStore.setState({ index: 2 })); // c starts: d is now the first row
    expect(document.querySelector('[data-dragging]')).toBeNull();
    expect(lifted.style.transform).toBe('');
    release();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shown()).toEqual(['d', 'e']);
  });

  it('the song changing at the very moment of release does not move the wrong song', () => {
    show();
    press(0, 20); // c
    moveTo(100);
    // The store has moved on; this component has not rendered it yet.
    usePlayerStore.setState({ index: 2 });
    release();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('radio adding songs mid-drag leaves the drag alone', () => {
    show();
    press(0, 20);
    moveTo(110);
    act(() => usePlayerStore.setState((s) => ({ queue: [...s.queue, song('radio')] })));
    release();
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c', 'radio']);
  });

  it('the queue changing under the song mid-drag drops the drag', () => {
    show();
    press(0, 20);
    moveTo(100);
    act(() => usePlayerStore.getState().removeUpcoming(2));
    expect(document.querySelector('[data-dragging]')).toBeNull();
    release();
    expect(ids()).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('Next up: the keyboard alternative', () => {
  it('arrow keys on the handle move the song one place, keep focus on it and say where it went', () => {
    show();
    handles()[0].focus();
    fireEvent.keyDown(handles()[0], { key: 'ArrowDown' });
    expect(ids()).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(document.activeElement).toBe(handles()[1]);
    expect(handles()[1]).toHaveAccessibleName('Reorder c');
    expect(screen.getByRole('status')).toHaveTextContent('c moved to 2 of 3');
    fireEvent.keyDown(handles()[1], { key: 'ArrowUp' });
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(document.activeElement).toBe(handles()[0]);
  });

  it('Home and End go to either end; past either end nothing moves', () => {
    show();
    fireEvent.keyDown(handles()[0], { key: 'End' });
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c']);
    fireEvent.keyDown(handles()[2], { key: 'Home' });
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const before = usePlayerStore.getState().queue;
    fireEvent.keyDown(handles()[0], { key: 'ArrowUp' });
    fireEvent.keyDown(handles()[2], { key: 'ArrowDown' });
    fireEvent.keyDown(handles()[0], { key: 'a' });
    expect(usePlayerStore.getState().queue).toBe(before);
  });
});

describe('Next up: the row', () => {
  it('a tap plays that entry; the handle and the menu do not', () => {
    show();
    fireEvent.click(handles()[0]);
    fireEvent.click(menu('d').getByRole('menuitem', { name: 'Remove from queue' }));
    expect(player.playAt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('e'));
    // d is gone, so e is entry 3 now.
    expect(player.playAt).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('Remove from queue takes out that song, moves focus to the next row and leaves the song playing', () => {
    show();
    fireEvent.click(menu('c').getByRole('menuitem', { name: 'Remove from queue' }));
    expect(ids()).toEqual(['a', 'b', 'd', 'e']);
    expect(usePlayerStore.getState().index).toBe(1);
    expect(document.activeElement).toBe(handles()[0]);
    expect(handles()[0]).toHaveAccessibleName('Reorder d');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('after the song changes, the same open row still removes its own song', () => {
    show();
    const removeE = menu('e').getByRole('menuitem', { name: 'Remove from queue' });
    act(() => usePlayerStore.setState({ index: 2 }));
    expect(removeE.isConnected).toBe(true);
    fireEvent.click(removeE);
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(usePlayerStore.getState().index).toBe(2);
  });

  it('removing the last song leaves no Next up, and Now playing goes on', () => {
    usePlayerStore.setState({ queue: [a, b], index: 0, baseCount: 2 });
    show();
    fireEvent.click(menu('b').getByRole('menuitem', { name: 'Remove from queue' }));
    expect(ids()).toEqual(['a']);
    expect(screen.queryByTestId('next-up')).toBeNull();
    expect(within(screen.getByTestId('now-playing')).getByTestId('track-row-title')).toHaveTextContent('a');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('Play next moves the song up; the row already next does not offer it', () => {
    show();
    expect(menu('c').queryByRole('menuitem', { name: 'Play next' })).toBeNull();
    fireEvent.click(menu('e').getByRole('menuitem', { name: 'Play next' }));
    expect(ids()).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('Go to artist closes the sheet and goes there; a song with no artist page does not offer it', () => {
    const noArtist = makeTrack({ id: 'youtube:n', sourceId: 'n', title: 'n', artistId: null });
    usePlayerStore.setState({ queue: [a, b, noArtist], index: 0, baseCount: 3 });
    const close = vi.fn();
    render(<QueueSheet open onOpenChange={close} />);
    expect(menu('n').queryByRole('menuitem', { name: 'Go to artist' })).toBeNull();
    fireEvent.click(menu('b').getByRole('menuitem', { name: 'Go to artist' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(router.push).toHaveBeenCalledWith('/artist/artist-b');
  });
});

describe('Next up: Clear and Shuffle', () => {
  const clearBtn = () => screen.getByRole('button', { name: 'Clear Next up' });

  it('sit beside "Next up · N"', () => {
    show();
    const heading = screen.getByText('Next up · 3').parentElement as HTMLElement;
    expect(within(heading).getByTestId('queue-header-actions')).toBeInTheDocument();
  });

  it('Clear asks first, and Cancel changes nothing', () => {
    show();
    fireEvent.click(clearBtn());
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Clear Next up?');
    expect(dialog).toHaveTextContent('The song playing now keeps playing.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('Clear empties Next up; the song playing keeps playing', async () => {
    show();
    fireEvent.click(clearBtn());
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }));
    });
    expect(ids()).toEqual(['a', 'b']);
    const st = usePlayerStore.getState();
    expect(st.index).toBe(1);
    expect(st.isPlaying).toBe(true);
    expect(screen.queryByTestId('next-up')).toBeNull();
    expect(within(screen.getByTestId('now-playing')).getByTestId('track-row-title')).toHaveTextContent('b');
    expect(player.playAt).not.toHaveBeenCalled();
  });

  it('Shuffle reorders Next up once and leaves the shuffle mode alone', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle Next up' }));
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c']);
    expect(usePlayerStore.getState().shuffle).toBe(false);
    expect(usePlayerStore.getState().orderBackup).toBeNull();
    vi.restoreAllMocks();
  });

  it('Shuffle has nothing to do with one song ahead', () => {
    usePlayerStore.setState({ queue: [a, b], index: 0, baseCount: 2 });
    show();
    expect(screen.getByRole('button', { name: 'Shuffle Next up' })).toBeDisabled();
    expect(clearBtn()).toBeEnabled();
  });
});

describe('The sheet when Next up shrinks', () => {
  it('keeps room under Now playing, so the list stays where the listener had it', () => {
    usePlayerStore.setState({ queue: [a, b], index: 0, baseCount: 2 });
    render(<QueueSheet open onOpenChange={() => {}} />);
    const scroller = screen.getByTestId('queue-scroller');
    const spacer = scroller.lastElementChild as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 120 });
    scroller.scrollTop = 40;
    fireEvent.click(menu('b').getByRole('menuitem', { name: 'Remove from queue' }));
    expect(spacer.style.height).toBe('380px');
    expect(scroller.scrollTop).toBe(40);
  });
});
