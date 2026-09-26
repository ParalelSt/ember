import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Track } from '@/types/track';

vi.mock('./AddToPlaylistMenu', () => ({
  AddToPlaylistMenu: ({ onRematch, moves }: { onRematch?: () => void; moves?: object }) => (
    <button type="button" data-rematch={!!onRematch} data-moves={!!moves}>
      Add to playlist
    </button>
  ),
}));
vi.mock('../ShareButton', () => ({ ShareButton: () => <button type="button">Share</button> }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
  DropdownMenuContent: ({ children }: PropsWithChildren) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}));

const { TrackMenu } = await import('./TrackMenu');

const track: Track = {
  id: 'youtube:abcdefghijk',
  source: 'youtube',
  sourceId: 'abcdefghijk',
  title: 'Song',
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 1,
  artworkUrl: null,
  streamUrl: '',
};

describe('TrackMenu re-match', () => {
  it('an imported track offers "Wrong song? Re-match"', () => {
    const onRematch = vi.fn();
    render(<TrackMenu track={track} onRematch={onRematch} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Wrong song\? Re-match/ }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    // Phones get the same item inside the add-to-playlist menu.
    expect(screen.getByRole('button', { name: 'Add to playlist' })).toHaveAttribute('data-rematch', 'true');
  });

  it('any other track has no More menu', () => {
    render(<TrackMenu track={track} />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByText(/Re-match/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to playlist' })).toHaveAttribute('data-rematch', 'false');
  });
});

describe('TrackMenu moves (a playlist in its own order)', () => {
  it('offers Move up and Move down (phones get them in the add-to-playlist menu)', () => {
    const up = vi.fn();
    const down = vi.fn();
    render(<TrackMenu track={track} moves={{ up, down }} />);
    expect(screen.getByRole('button', { name: 'Add to playlist' })).toHaveAttribute('data-moves', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Move down/ }));
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('the first song cannot move up, the last cannot move down', () => {
    render(<TrackMenu track={track} moves={{ down: vi.fn() }} />);
    expect(screen.queryByRole('menuitem', { name: /Move up/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Move down/ })).toBeInTheDocument();
  });

  it('no possible move and no re-match: no More menu', () => {
    render(<TrackMenu track={track} moves={{}} />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
