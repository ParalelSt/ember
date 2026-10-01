/** The player bar says which song could not play (the owner's pick from
 *  /dizajn/unplayable, option B): the warning in place of the cover, a bold
 *  "Skipped: <title>" (or "Skipped 3 songs"), the reason under it, for about
 *  3 s, then the song again. A stop stays until the listener acts. No toast. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PhonePlayerBar } from './PhonePlayerBar';
import { UnplayableAnnouncer, UnplayableMessage } from './UnplayableMessage';
import { resetUnplayableStore, showUnplayable } from '@/stores/useUnplayableStore';
import { BAR_MESSAGE_MS } from '@/lib/playback/unplayableBar';
import type { UnplayableNotice } from '@/lib/playback/unplayable';
import { makeTrack } from '@/test-utils/fakeBackend';

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ className }: { className?: string }) => <input type="range" aria-label="progress" className={className} readOnly />,
}));

const PLAYING = makeTrack({ id: 'youtube:g', title: 'Glass Coast', artist: 'Aftertone' });
const n = (title: string, over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
  trackId: `youtube:${title}`, title, kind: 'unavailable', reason: 'unavailable', outcome: 'skipped', ...over,
});

function renderBar() {
  const h = { onToggle: vi.fn(), onSeek: vi.fn(), onNext: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn(), onOpenQueue: vi.fn() };
  render(
    <>
      <UnplayableAnnouncer />
      <PhonePlayerBar track={PLAYING} playing position={10} duration={200} {...h} />
    </>,
  );
  return h;
}
const say = (notices: UnplayableNotice[], opts?: { away?: boolean }) => act(() => showUnplayable(notices, opts));
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const top = () => screen.getByTestId('unplayable-top').textContent;
const bottom = () => screen.getByTestId('unplayable-bottom').textContent;
// The marquee draws the title twice (one is its ruler).
const songShown = () => screen.queryAllByText('Glass Coast').length > 0;

beforeEach(() => { vi.useFakeTimers(); resetUnplayableStore(); });
afterEach(() => { act(() => resetUnplayableStore()); vi.useRealTimers(); });

describe('the phone bar\'s message', () => {
  it('shows the song when nothing went wrong', () => {
    renderBar();
    expect(screen.queryByTestId('unplayable-message')).toBeNull();
    expect(songShown()).toBe(true);
  });

  it('one song: "Skipped: <title>", the reason, then back to the song after about 3 s', () => {
    renderBar();
    say([n('Field Day')]);
    expect(top()).toBe('Skipped: Field Day');
    expect(bottom()).toBe('Not available on YouTube');
    // The warning takes the cover's place; the song is out of the bar.
    expect(songShown()).toBe(false);
    tick(BAR_MESSAGE_MS - 1);
    expect(screen.getByTestId('unplayable-message')).toBeInTheDocument();
    tick(1);
    expect(screen.queryByTestId('unplayable-message')).toBeNull();
    expect(songShown()).toBe(true);
  });

  it('a burst collapses: "Skipped 3 songs"', () => {
    renderBar();
    say([n('Field Day')]);
    tick(500);
    say([n('Night Swim')]);
    tick(500);
    say([n('Paper Planes')]);
    expect(screen.getAllByTestId('unplayable-message')).toHaveLength(1);
    expect(top()).toBe('Skipped 3 songs');
    expect(bottom()).toBe('Not available on YouTube');
    tick(BAR_MESSAGE_MS);
    expect(songShown()).toBe(true);
  });

  it('a passing failure stays until acted on, and a tap retries (not the queue, not the full view)', () => {
    const h = renderBar();
    say([n('Glass Coast', { kind: 'transient', reason: null, outcome: 'stopped' })]);
    expect(top()).toBe("Couldn't load Glass Coast right now");
    expect(bottom()).toBe('Tap to retry');
    tick(60_000);
    expect(screen.getByTestId('unplayable-message')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unplayable-message'));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect(h.onOpenQueue).not.toHaveBeenCalled();
    expect(h.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unplayable-message')).toBeNull();
  });

  it('"stopped after 5" stays until the listener acts', () => {
    renderBar();
    say([n('a'), n('b'), n('c'), n('d'), n('e', { outcome: 'gave-up' })]);
    expect(top()).toBe('Playback stopped');
    expect(bottom()).toBe("5 songs in a row couldn't play");
    tick(60_000);
    expect(top()).toBe('Playback stopped');
  });

  it('coming back: "Skipped N songs" while you were away, gone after the same 3 s', () => {
    renderBar();
    say([n('a'), n('b'), n('c')], { away: true });
    expect(top()).toBe('Skipped 3 songs');
    expect(bottom()).toBe('While you were away · Not available on YouTube');
    tick(BAR_MESSAGE_MS);
    expect(screen.queryByTestId('unplayable-message')).toBeNull();
  });

  it('a tap on a skip opens the queue, where the songs are listed', () => {
    const h = renderBar();
    say([n('Field Day')]);
    fireEvent.click(screen.getByTestId('unplayable-message'));
    expect(h.onOpenQueue).toHaveBeenCalledTimes(1);
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it('play and next stay live beside the message', () => {
    const h = renderBar();
    say([n('Field Day')]);
    fireEvent.click(screen.getByLabelText('Pause'));
    fireEvent.click(screen.getByLabelText('Next'));
    expect(h.onToggle).toHaveBeenCalled();
    expect(h.onNext).toHaveBeenCalled();
  });

  it('screen readers hear it once, politely, as a whole sentence', () => {
    renderBar();
    const live = screen.getByTestId('unplayable-announcer');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('');
    say([n('Field Day', { reason: 'removed' })]);
    expect(live).toHaveTextContent('Couldn\'t play "Field Day": removed from YouTube. Skipped to the next song.');
    tick(BAR_MESSAGE_MS);
    expect(live).toHaveTextContent('');
  });
});

describe('the same message in the full-screen player and the desktop bar', () => {
  it('full screen: the title area says it, big', () => {
    render(<UnplayableMessage size="player" />);
    say([n('Field Day', { reason: 'private' })]);
    const msg = screen.getByTestId('unplayable-message');
    expect(msg).toHaveAttribute('data-size', 'player');
    expect(top()).toBe('Skipped: Field Day');
    expect(bottom()).toBe('Made private');
    expect(screen.getByTestId('unplayable-top')).toHaveClass('text-2xl');
  });

  it('desktop: the bar\'s left cluster says it', () => {
    const onRetry = vi.fn();
    render(<UnplayableMessage size="desktop" onRetry={onRetry} />);
    say([n('Glass Coast', { kind: 'transient', outcome: 'stopped' })]);
    expect(screen.getByTestId('unplayable-message')).toHaveAttribute('data-size', 'desktop');
    fireEvent.click(screen.getByTestId('unplayable-message'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('nothing at all while there is nothing to say', () => {
    const { container } = render(<UnplayableMessage size="player" />);
    expect(container).toBeEmptyDOMElement();
  });
});
