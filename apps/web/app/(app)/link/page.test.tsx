import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/** /link (plan 1b, finding 4): after a signed-out phone signs in, the
 *  approve token comes from the short httpOnly cookie proxy.ts set, never
 *  from the URL. */

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'ember_link' && jar.value !== undefined ? { name, value: jar.value } : undefined) }),
}));
const seen = vi.hoisted(() => ({ token: 'unset' as string | null }));
vi.mock('@/components/auth/ApproveLinkView', () => ({
  ApproveLinkView: ({ token }: { token: string | null }) => {
    seen.token = token;
    return <div data-testid="view" />;
  },
}));

const { default: LinkPage } = await import('./page');
const TOKEN = 'AbC_-'.repeat(8) + 'xyz';

async function open() {
  const el = await LinkPage();
  await act(async () => {
    render(<Suspense fallback={null}>{el}</Suspense>);
  });
}

beforeEach(() => {
  seen.token = 'unset';
  jar.value = undefined;
});

describe('/link', () => {
  it('approves the request whose token proxy.ts stashed', async () => {
    jar.value = TOKEN;
    await open();
    expect(seen.token).toBe(TOKEN);
    expect(screen.getByTestId('view')).toBeInTheDocument();
  });

  it('with no stashed token (or a malformed one) there is nothing to approve', async () => {
    await open();
    expect(seen.token).toBeNull();
    jar.value = 'junk';
    await open();
    expect(seen.token).toBeNull();
  });
});
