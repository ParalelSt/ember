import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { moveItem } from '@/lib/collab';
import type { Track } from '@/types/track';
import { ReorderList } from './ReorderList';

const track = (id: string): Track => ({
  id,
  source: 'youtube',
  sourceId: id,
  title: `Song ${id}`,
  artist: 'Band',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});

function Harness() {
  const [tracks, setTracks] = useState(['a', 'b', 'c', 'd'].map(track));
  return <ReorderList tracks={tracks} onMove={(from, to) => setTracks((t) => moveItem(t, from, to))} />;
}
const titles = () => screen.getAllByTestId('reorder-row').map((r) => within(r).getByTestId('reorder-title').textContent);

describe('ReorderList (Edit order)', () => {
  it('rows have up and down arrows and a drag handle; no heart, no number, no play', () => {
    render(<Harness />);
    const first = screen.getAllByTestId('reorder-row')[0];
    expect(within(first).getByRole('button', { name: 'Move Song a up' })).toBeDisabled();
    expect(within(first).getByRole('button', { name: 'Move Song a down' })).toBeEnabled();
    expect(within(first).getByRole('button', { name: 'Drag Song a' })).toBeInTheDocument();
    expect(within(first).queryByRole('button', { name: /Like|Unlike|Play/ })).toBeNull();
    expect(first).not.toHaveTextContent('1');
    const last = screen.getAllByTestId('reorder-row')[3];
    expect(within(last).getByRole('button', { name: 'Move Song d down' })).toBeDisabled();
  });

  it('the arrows move a song one place', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Song c up' }));
    expect(titles()).toEqual(['Song a', 'Song c', 'Song b', 'Song d']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Song a down' }));
    expect(titles()).toEqual(['Song c', 'Song a', 'Song b', 'Song d']);
  });

  it('dragging the handle moves the song under the finger as it goes', () => {
    render(<Harness />);
    // jsdom lays nothing out: each row 50px tall, one under the other.
    const rect = (top: number) => ({ top, bottom: top + 50, height: 50, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) });
    const place = () =>
      screen.getAllByTestId('reorder-row').forEach((r, i) => {
        r.getBoundingClientRect = () => rect(i * 50) as DOMRect;
      });
    place();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Drag Song a' }), { clientY: 25, pointerId: 1 });
    expect(screen.getAllByTestId('reorder-row')[0]).toHaveAttribute('data-dragging', 'true');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: 130 }));
    });
    expect(titles()).toEqual(['Song b', 'Song c', 'Song a', 'Song d']);
    place();
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(screen.getAllByTestId('reorder-row').some((r) => r.getAttribute('data-dragging') === 'true')).toBe(false);
    // After the drop, moving the pointer does nothing.
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: 0 }));
    });
    expect(titles()).toEqual(['Song b', 'Song c', 'Song a', 'Song d']);
  });
});
