import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AddChoice, CarlistLive, type CarlistLiveProps } from './CarlistLive';
import type { SessionState, Track } from '@/types/track';

const track = (id: string, title: string, artist: string): Track => ({
  id: `youtube:${id}`,
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
});

const hana = { id: 'u1', name: 'Hana', avatarUrl: null };
const marko = { id: 'u2', name: 'Marko', avatarUrl: null };
const nameless = { id: 'u3', name: 'Unnamed member', avatarUrl: null };

function state(patch: Partial<SessionState['session']> = {}): SessionState {
  return {
    session: {
      id: 's1',
      code: 'K7MPQ4',
      name: 'Road trip',
      active: true,
      nowIndex: 1,
      hostName: 'Hana',
      hostId: 'u1',
      isHost: false,
      viewerId: 'u2',
      nowElapsedMs: 0,
      ...patch,
    },
    members: [hana, marko, nameless],
    queue: [
      { id: 'q1', position: 1, played: true, addedByName: 'Hana', addedBy: hana, track: track('a', 'Motion Sickness', 'Phoebe Bridgers') },
      { id: 'q2', position: 2, played: false, addedByName: 'Marko', addedBy: marko, track: track('b', 'Dreams', 'Fleetwood Mac') },
      { id: 'q3', position: 3, played: false, addedByName: 'Unnamed member', addedBy: nameless, track: track('c', 'Electric Feel', 'MGMT') },
    ],
  };
}

function setup(patch: Partial<CarlistLiveProps> = {}, session: Partial<SessionState['session']> = {}) {
  const props: CarlistLiveProps = {
    state: state(session),
    progress: 0.4,
    saved: false,
    onSkip: vi.fn(),
    onEnd: vi.fn(),
    onSave: vi.fn(),
    onShare: vi.fn(),
    addSlot: <div data-testid="add-slot" />,
    ...patch,
  };
  render(<CarlistLive {...props} />);
  return props;
}

describe('CarlistLive: the top (head and now-playing card)', () => {
  it('eyebrow, title, the code chip, who is in and whose phone plays', () => {
    const p = setup();
    expect(screen.getByText('Carlist')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Road trip');
    expect(screen.getByTestId('in-the-car')).toHaveTextContent("3 in the car · Hana's phone plays");
    fireEvent.click(screen.getByTestId('code-chip'));
    expect(screen.getByTestId('code-chip')).toHaveTextContent('K7MPQ4');
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('the big card: NOW PLAYING, title, artist, added by (You for the viewer), progress, Skip', () => {
    const p = setup();
    const card = screen.getByTestId('now-card');
    expect(within(card).getByText(/Now playing/i)).toBeInTheDocument();
    expect(within(card).getByTestId('now-title')).toHaveTextContent('Dreams');
    expect(within(card).getByText('Fleetwood Mac')).toBeInTheDocument();
    expect(within(card).getByTestId('who')).toHaveTextContent('Added by You');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    fireEvent.click(within(card).getByTestId('skip'));
    expect(p.onSkip).toHaveBeenCalledTimes(1);
  });

  it('the host: "your phone plays" and End carlist', () => {
    const p = setup({}, { isHost: true, viewerId: 'u1' });
    expect(screen.getByTestId('in-the-car')).toHaveTextContent('3 in the car · your phone plays');
    fireEvent.click(screen.getByRole('button', { name: 'End carlist' }));
    expect(p.onEnd).toHaveBeenCalledTimes(1);
  });

  it('a guest has no End', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'End carlist' })).toBeNull();
  });
});

describe('CarlistLive: the bottom (queue and add)', () => {
  it('numbered rows, who added each, played dimmed, the current one highlighted', () => {
    setup();
    const rows = screen.getAllByTestId('queue-row');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['played', 'now', 'next']);
    expect(rows[0].className).toMatch(/opacity-40/);
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(rows[1].className).toMatch(/bg-card/);
    expect(rows.map((r) => within(r).getByTestId('added-by').textContent)).toEqual(['Hana', 'You', 'Unnamed member']);
    expect(rows[2]).toHaveTextContent('3Electric FeelMGMT');
  });

  it('Queue heading with Save as playlist on the right', () => {
    const p = setup({}, { isHost: true, viewerId: 'u1' });
    expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('save-playlist'));
    expect(p.onSave).toHaveBeenCalledTimes(1);
  });

  it('the add search sits at the bottom while live', () => {
    setup();
    const page = screen.getByTestId('carlist-live-page');
    expect(page.lastElementChild).toContainElement(screen.getByTestId('add-slot'));
  });

  it('ended: a note, no Skip, no End, no add', () => {
    setup({}, { active: false, isHost: true, viewerId: 'u1' });
    expect(screen.getByTestId('ended')).toHaveTextContent('This carlist has ended.');
    expect(screen.queryByTestId('skip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'End carlist' })).toBeNull();
    expect(screen.queryByTestId('add-slot')).toBeNull();
  });

  it('an empty carlist says so', () => {
    render(
      <CarlistLive
        state={{ ...state(), queue: [], session: { ...state().session, nowIndex: 0 } }}
        progress={null}
        saved={false}
        onSkip={vi.fn()}
        onEnd={vi.fn()}
        onSave={vi.fn()}
        onShare={vi.fn()}
      />,
    );
    expect(screen.getByTestId('now-card')).toHaveTextContent('Nothing queued yet');
    expect(screen.getByTestId('save-playlist')).toBeDisabled();
  });
});

describe('AddChoice', () => {
  const t = track('d', 'Midnight City', 'M83');

  it('Add, then Play next or Add to end', () => {
    const onAdd = vi.fn();
    render(<AddChoice track={t} isAdded={false} onAdd={onAdd} />);
    expect(screen.queryByTestId('add-choice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Midnight City next' }));
    expect(onAdd).toHaveBeenLastCalledWith('next');
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City to the end' }));
    expect(onAdd).toHaveBeenLastCalledWith('end');
  });

  it('already in the carlist: Added, no choice', () => {
    render(<AddChoice track={t} isAdded onAdd={vi.fn()} />);
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
