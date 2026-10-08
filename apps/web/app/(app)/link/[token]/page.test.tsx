import { Suspense, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/** /link/<token> (plan 1b): the token goes to the approve card and leaves
 *  the address bar at once. */

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
const seen = vi.hoisted(() => ({ credential: null as unknown }));
vi.mock('@/components/auth/ApproveSignIn', () => ({
  ApproveSignIn: ({ credential }: { credential: unknown }) => {
    seen.credential = credential;
    return <div data-testid="approve-card-stub" />;
  },
}));

const { default: ApproveLinkPage } = await import('./page');
const TOKEN = 'AbC_-'.repeat(8) + 'xyz';

async function open(token: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ApproveLinkPage params={Promise.resolve({ token })} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  seen.credential = null;
  window.history.replaceState(null, '', `/link/${TOKEN}`);
});

describe('/link/[token]', () => {
  it('hands the token to the approve card and scrubs it from the address bar', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    await open(TOKEN);
    expect(seen.credential).toEqual({ token: TOKEN });
    expect(replace).toHaveBeenCalledWith(null, '', '/link');
    expect(window.location.pathname).toBe('/link');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('a malformed token never reaches the server, and points to the code input', async () => {
    await open('not-a-token');
    expect(screen.queryByTestId('approve-card-stub')).toBeNull();
    expect(screen.getByRole('link', { name: /Have a code/ })).toHaveAttribute('href', '/settings/devices');
    expect(window.location.pathname).toBe('/link');
  });
});
