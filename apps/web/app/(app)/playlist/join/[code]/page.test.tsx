import { Suspense, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ joinPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const { default: JoinPlaylistPage } = await import('./page');

async function open(code: string) {
  const client = new QueryClient();
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <JoinPlaylistPage params={Promise.resolve({ code })} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/playlist/join/[code]', () => {
  it('joins once and opens the playlist', async () => {
    api.joinPlaylist.mockResolvedValue({ playlistId: 'pl1', joined: true });
    await open('c'.repeat(32));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/playlist/pl1'));
    expect(api.joinPlaylist).toHaveBeenCalledTimes(1);
    expect(api.joinPlaylist).toHaveBeenCalledWith('c'.repeat(32));
    expect(toast.success).toHaveBeenCalled();
  });

  it('already a member (or the owner): straight to the playlist, no toast', async () => {
    api.joinPlaylist.mockResolvedValue({ playlistId: 'pl1', joined: false });
    await open('c'.repeat(32));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/playlist/pl1'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a dead link says so and goes nowhere', async () => {
    api.joinPlaylist.mockRejectedValue(new Error('This invite link doesn’t work anymore. Ask the owner for a new one.'));
    await open('dead');
    expect(await screen.findByTestId('join-problem')).toHaveTextContent(/doesn’t work anymore/);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
