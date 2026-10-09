import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** After sign-in /auth?next= sends you on, but only to a page on this site
 *  (bughunt V2). */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: nav.refresh }),
  useSearchParams: () => nav.search,
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ signIn: vi.fn(async () => ({ error: null })), signUp: vi.fn(), adoptSession: vi.fn() }),
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
  // A desktop opens on the QR; the form is behind "Use password instead".
  fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
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

describe('AuthPage on a desktop: the QR is the hero', () => {
  it('opens on the QR with its steps, the form only behind Use password instead', async () => {
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    expect(screen.getByRole('heading', { name: 'Sign in with your phone' })).toBeInTheDocument();
    expect(screen.getByTestId('qr-sign-in')).toBeInTheDocument();
    expect(screen.getByTestId('qr-steps')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-sign-in')).toBeNull();
  });

  it('Use QR code instead goes back to the QR, from either stage of the form', async () => {
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use QR code instead' }));
    expect(screen.getByTestId('qr-sign-in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    await screen.findByLabelText('Password');
    fireEvent.click(screen.getByRole('button', { name: 'Use QR code instead' }));
    expect(screen.getByTestId('qr-sign-in')).toBeInTheDocument();
  });

  it('the QR stops polling while the password form is up', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', f);
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('the password form still works when the QR routes fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/qr/')) return new Response(JSON.stringify({ error: 'down' }), { status: 503 });
      return new Response(JSON.stringify({ status: 'existing' }), { status: 200 });
    }));
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    expect(await screen.findByText(/Can't get a code right now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use password instead' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});

describe('AuthPage QR on phones', () => {
  const setUa = (ua: string) => vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
  afterEach(() => vi.restoreAllMocks());

  it('does not render or start the QR on an iPhone', async () => {
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('qr-sign-in')).toBeNull();
    expect(f.mock.calls.some((c) => String((c as unknown[])[0]).includes('/api/auth/qr'))).toBe(false);
    // The password form directly, with no way to a QR it cannot use.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use QR code instead' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use password instead' })).toBeNull();
  });

  it('an Android phone in the Ember app gets the form directly too', () => {
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-sign-in')).toBeNull();
  });

  it('does not render the QR on an Android car screen', () => {
    setUa('Mozilla/5.0 (Linux; Android 12) Chrome/120 Safari/537.36 EmberCar');
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    expect(screen.queryByTestId('qr-sign-in')).toBeNull();
  });

  it('still renders and starts the QR on desktop', async () => {
    setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120');
    const f = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', f);
    nav.search = new URLSearchParams();
    render(<AuthPage />);
    expect(screen.getByTestId('qr-sign-in')).toBeInTheDocument();
    await waitFor(() => expect(f.mock.calls.some((c) => String((c as unknown[])[0]).includes('/api/auth/qr/start'))).toBe(true));
  });
});
