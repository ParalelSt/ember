import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** After sign-in /auth?next= sends you on, but only to a page on this site
 *  (bughunt V2). */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  useSearchParams: () => nav.search,
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ signIn: vi.fn(async () => ({ error: null })), signUp: vi.fn() }),
}));

const { default: AuthPage } = await import('./page');

beforeEach(() => {
  nav.push.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'existing' }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Signs in on /auth?<query> and returns where the page sent the browser. */
async function signInWith(query: string): Promise<string> {
  nav.search = new URLSearchParams(query);
  render(<AuthPage />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
  const pw = await screen.findByLabelText('Password');
  fireEvent.change(pw, { target: { value: 'longenough1' } });
  fireEvent.submit(pw.closest('form')!);
  await waitFor(() => expect(nav.push).toHaveBeenCalled());
  return nav.push.mock.calls[0][0] as string;
}

describe('AuthPage next= [bughunt V2]', () => {
  it('goes back to the page you came from', async () => {
    expect(await signInWith('next=%2Flibrary%2Fliked%3Ftab%3Dall')).toBe('/library/liked?tab=all');
  });

  it.each([
    ['backslash', 'next=/%5Cexample.com'],
    ['two backslashes', 'next=%5C%5Cexample.com'],
    ['protocol-relative', 'next=//example.com'],
    ['encoded protocol-relative', 'next=%2F%2Fexample.com'],
    ['tab inside the slashes', 'next=/%09/example.com'],
    ['absolute', 'next=https://example.com'],
  ])('never leaves the site: %s', async (_label, query) => {
    expect(await signInWith(query)).toBe('/');
  });
});
