import type { ComponentProps, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/components/track/menus/TrackSearchPicker', () => ({ TrackSearchPicker: () => <div data-testid="picker" /> }));
vi.mock('@/lib/logger/client', () => ({ logger: { breadcrumb: vi.fn() } }));
const api = vi.hoisted(() => ({ importInspect: vi.fn(), importStart: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const { CreatePlaylistDialog } = await import('./CreatePlaylistDialog');

const LINK = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const items = Array.from({ length: 42 }, (_, i) => ({ position: i, title: `S${i}`, artists: [], artist: '', durationMs: null, explicit: null, uri: null }));

function setup(over: Partial<ComponentProps<typeof CreatePlaylistDialog>> = {}) {
  const props = { open: true, onOpenChange: vi.fn(), onCreate: vi.fn(), onImported: vi.fn(), ...over };
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <CreatePlaylistDialog {...props} />
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  push.mockReset();
  api.importInspect.mockReset();
  api.importStart.mockReset();
});

describe('CreatePlaylistDialog tabs', () => {
  it('opens on "Start empty": the name field and the song picker', () => {
    setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Start empty', 'Import from a link']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Playlist name (e.g. Metal)')).toBeInTheDocument();
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(screen.queryByLabelText('Playlist link')).toBeNull();
  });

  it('"Start empty" still creates with the typed name', async () => {
    const p = setup();
    fireEvent.change(screen.getByPlaceholderText('Playlist name (e.g. Metal)'), { target: { value: ' Metal ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith('Metal', []));
    await waitFor(() => expect(p.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('"Import from a link": a pasted link is looked up and previewed', async () => {
    api.importInspect.mockResolvedValue({ source: 'spotify', id: 'x', name: 'Late night drive', coverUrl: null, items, truncated: false });
    setup();
    fireEvent.click(screen.getByRole('tab', { name: /Import from a link/ }));
    expect(screen.getByRole('tab', { name: /Import from a link/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    await screen.findByTestId('link-preview');
    expect(api.importInspect).toHaveBeenCalledWith(LINK);
    expect(screen.getByText('Late night drive')).toBeInTheDocument();
    expect(screen.getByText('42 songs')).toBeInTheDocument();
    expect(screen.getByTestId('source-badge')).toHaveTextContent('Spotify');
    expect(screen.queryByTestId('first-100-note')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create, import 42 songs' })).toBeEnabled();
  });

  it('a Spotify playlist cut at 100 says so', async () => {
    api.importInspect.mockResolvedValue({ source: 'spotify', id: 'x', name: 'Long', coverUrl: null, items, truncated: true });
    setup();
    fireEvent.click(screen.getByRole('tab', { name: /Import from a link/ }));
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    expect(await screen.findByTestId('first-100-note')).toHaveTextContent('First 100 songs.');
  });

  it('Create starts the import, closes the dialog and opens the playlist', async () => {
    api.importInspect.mockResolvedValue({ source: 'spotify', id: 'x', name: 'Late night drive', coverUrl: null, items, truncated: false });
    api.importStart.mockResolvedValue({ playlistId: 'p1', job: { source: 'spotify', total: 42 } });
    const p = setup();
    fireEvent.click(screen.getByRole('tab', { name: /Import from a link/ }));
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    fireEvent.click(await screen.findByRole('button', { name: 'Create, import 42 songs' }));
    await waitFor(() => expect(api.importStart).toHaveBeenCalledWith(LINK));
    await waitFor(() => expect(p.onOpenChange).toHaveBeenCalledWith(false));
    expect(p.onImported).toHaveBeenCalledWith('p1');
    expect(push).toHaveBeenCalledWith('/playlist/p1');
  });

  it('a link Ember cannot read is never sent; a failed look-up shows the reason', async () => {
    api.importInspect.mockRejectedValue(new Error("Couldn't find that playlist."));
    setup();
    fireEvent.click(screen.getByRole('tab', { name: /Import from a link/ }));
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: 'https://example.com/x' } });
    expect(screen.getByText(/not a playlist link/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(api.importInspect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: LINK } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't find that playlist.");
  });

  it('reopening starts on "Start empty" again', () => {
    const qc = new QueryClient();
    const props = { onOpenChange: vi.fn(), onCreate: vi.fn() };
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CreatePlaylistDialog open {...props} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Import from a link/ }));
    for (const open of [false, true]) {
      rerender(
        <QueryClientProvider client={qc}>
          <CreatePlaylistDialog open={open} {...props} />
        </QueryClientProvider>,
      );
    }
    expect(screen.getByRole('tab', { name: 'Start empty' })).toHaveAttribute('aria-selected', 'true');
  });
});
