import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ joinSession: vi.fn(), createSession: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
const playlists = vi.hoisted(() => ({ data: [] as { id: string; name: string }[] }));
vi.mock('@/hooks/useLibrary', () => ({ useQueryPlaylists: () => playlists, QK: { playlists: ['playlists'] } }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u2' } }) }));

const { JoinSessionDialog, StartSessionDialog } = await import('./SessionDialogs');

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JoinSessionDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return screen.getByRole('textbox', { name: 'Join code' });
}

beforeEach(() => {
  vi.clearAllMocks();
  playlists.data = [];
});

describe('JoinSessionDialog: typing the code is the fallback', () => {
  it('a typed code joins and opens the carlist', async () => {
    api.joinSession.mockResolvedValue({ session: { id: 's1', name: 'Road trip', code: 'K7MPQ4' } });
    const input = setup();
    fireEvent.change(input, { target: { value: 'k7mpq4' } });
    expect(input).toHaveValue('K7MPQ4');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/session/s1'));
    expect(api.joinSession).toHaveBeenCalledWith('K7MPQ4');
  });

  it('a pasted join link works too', async () => {
    api.joinSession.mockResolvedValue({ session: { id: 's1', name: 'Road trip', code: 'K7MPQ4' } });
    const input = setup();
    fireEvent.change(input, { target: { value: 'https://ember.example/session/join/K7MPQ4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.joinSession).toHaveBeenCalledWith('K7MPQ4'));
  });

  it('something that is not a code is caught before asking', async () => {
    const input = setup();
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(toast.error).toHaveBeenCalled();
    expect(api.joinSession).not.toHaveBeenCalled();
  });
});

// Bughunt V3: a select is as wide as its longest option, so a long playlist
// name pushed the Start a session dialog past the screen's edge. The select
// and its column must be allowed to shrink to the dialog.
describe('StartSessionDialog', () => {
  it('lets the playlist select shrink to the dialog instead of its longest option', () => {
    const LONG = 'BUGHUNT Supercalifragilisticexpialidocious playlist with an extremely long name';
    playlists.data = [{ id: 'p1', name: LONG }];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StartSessionDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    const select = screen.getByRole('combobox', { name: 'Seed from playlist' });
    expect(select).toHaveTextContent(LONG);
    expect(select).toHaveClass('w-full', 'min-w-0', 'truncate');
    expect(select.parentElement).toHaveClass('min-w-0');
  });
});
