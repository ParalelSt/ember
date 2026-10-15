import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toSummary } from '@/lib/collections';
import { isPublicPage } from '@/lib/publicPaths';
import Page from './page';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a> }));

const mocks = vi.hoisted(() => ({ play: vi.fn(), success: vi.fn(), error: vi.fn(), writeText: vi.fn(), empty: false }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/hooks/usePlayCollection', () => ({ usePlayCollection: () => ({ play: mocks.play, isPlaying: () => false }) }));
vi.mock('@/hooks/useCollections', () => ({ useCollections: () => ({
  isLoading: false,
  system: [toSummary({ kind: 'liked' }, { count: 7 })],
  playlists: mocks.empty ? [] : [toSummary({ kind: 'playlist', id: 'real' }, { name: 'Owner playlist', trackArtworks: ['/a', '/b', '/c', '/d'], trackCount: 23 })],
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.empty = false;
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.writeText } });
});

describe('Dizajn', () => {
  it('renders every option with real covers, links, counts and playback', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Dizajn: quick grid' })).toBeInTheDocument();
    const ids = [...Array.from({length: 10}, (_, i) => `A${i+1}`), ...Array.from({length: 8}, (_, i) => `B${i+1}`)];
    for (const id of ids) expect(screen.getByRole('button', { name: `Copy ${id}` })).toBeInTheDocument();
    const a1 = screen.getByRole('region', { name: 'A1' });
    expect(within(a1).getByRole('link', { name: 'Owner playlist' })).toHaveAttribute('href', '/playlist/real');
    expect(a1.querySelector('[data-mosaic]')).not.toBeNull();
    expect(a1.querySelector('[data-liked-cover]')).not.toBeNull();
    expect(within(screen.getByRole('region', {name: 'B5'})).getByText('23 songs')).toBeInTheDocument();
    fireEvent.click(within(a1).getByRole('button', { name: 'Play Owner playlist' }));
    expect(mocks.play).toHaveBeenCalledWith({ kind: 'playlist', id: 'real' }, 'Owner playlist');
    expect(isPublicPage('/dizajn')).toBe(false);
  });

  it('changes every frame width and collection count and toggles chips', () => {
    render(<Page />);
    for (const width of ['1280', '1600', '1920', '2560', 'Actual']) {
      fireEvent.change(screen.getByLabelText('Preview width'), { target: { value: width } });
      for (const frame of screen.getAllByTestId('preview-frame')) expect(frame).toHaveStyle({ width: width === 'Actual' ? '100%' : `${width}px` });
    }
    for (const count of [5, 8, 3]) {
      fireEvent.change(screen.getByLabelText('Playlist count'), { target: { value: String(count) } });
      // A10 deliberately hides overflow when its frame is narrow.
      for (const list of screen.getAllByRole('list').filter((el) => !el.closest('[aria-label="A10"]'))) {
        expect(within(list).getAllByRole('listitem')).toHaveLength(count);
      }
    }
    expect(screen.getAllByRole('toolbar', { name: 'Filter Home' })).toHaveLength(18);
    fireEvent.click(screen.getByLabelText('Show chips'));
    expect(screen.queryByRole('toolbar', { name: 'Filter Home' })).toBeNull();
  });

  it('repeats Liked songs for an account without playlists', () => {
    mocks.empty = true;
    render(<Page />);
    expect(within(screen.getByRole('region', { name: 'A1' })).getAllByRole('link', { name: 'Liked songs' })).toHaveLength(3);
  });

  it('copies an option id and reports success only after copying', async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy A6' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Copied A6'));
    expect(mocks.writeText).toHaveBeenCalledWith('A6');
  });

  it('reports clipboard failure without claiming success', async () => {
    mocks.writeText.mockRejectedValue(new Error('denied'));
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy B8' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
