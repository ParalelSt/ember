import { Suspense, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const api = vi.hoisted(() => ({ joinSession: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u2' } }) }));

const { default: JoinCarlistPage } = await import('./page');

async function open(code: string) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <JoinCarlistPage params={Promise.resolve({ code })} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  return { invalidate };
}

beforeEach(() => vi.clearAllMocks());

describe('/session/join/[code] (the QR code and the copied link)', () => {
  it('signed in: joins once and opens the live carlist', async () => {
    api.joinSession.mockResolvedValue({ session: { id: 's1', name: 'Road trip', code: 'K7MPQ4' } });
    const { invalidate } = await open('k7mpq4');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/session/s1'));
    expect(api.joinSession).toHaveBeenCalledTimes(1);
    expect(api.joinSession).toHaveBeenCalledWith('K7MPQ4');
    expect(toast.success).toHaveBeenCalled();
    // The Carlist button in Your library turns into "Live · K7MPQ4".
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['carlist', 'live'] });
  });

  it('a link with no code in it never asks the server', async () => {
    await open('%22%3B--');
    expect(await screen.findByTestId('join-problem')).toHaveTextContent(/no carlist code/);
    expect(api.joinSession).not.toHaveBeenCalled();
  });

  it('an ended carlist says so and goes nowhere', async () => {
    api.joinSession.mockRejectedValue(new Error('No live session with that code.'));
    await open('ZZZZZZ');
    expect(await screen.findByTestId('join-problem')).toHaveTextContent('No live session with that code.');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
