import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Settings > Devices (plan 1c): type a code to approve, the recent QR
 *  sign-ins, and Sign out everywhere. */

const h = vi.hoisted(() => ({ signOut: vi.fn(async () => {}), credentials: [] as unknown[] }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ signOut: h.signOut, user: { id: 'u1', email: 'r@x' } }) }));
vi.mock('@/components/auth/ApproveSignIn', () => ({
  ApproveSignIn: ({ credential }: { credential: unknown }) => {
    h.credentials.push(credential);
    return <div data-testid="approve-card-stub">{JSON.stringify(credential)}</div>;
  },
}));

const { DevicesPanel } = await import('./DevicesPanel');

let recentBody: unknown = { signIns: [] };
let revokeStatus = 200;
const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  h.signOut.mockClear();
  h.credentials = [];
  calls.length = 0;
  recentBody = { signIns: [] };
  revokeStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/recent')) return new Response(JSON.stringify(recentBody), { status: 200 });
    if (url.endsWith('/revoke-all')) return new Response(JSON.stringify(revokeStatus === 200 ? { ok: true } : { error: 'nope' }), { status: revokeStatus });
    throw new Error(`unexpected ${url}`);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    render(<DevicesPanel />);
  });
}

describe('DevicesPanel', () => {
  it('Type the code: upper-cases as you type and opens the approve card with the code', async () => {
    await mount();
    const input = screen.getByLabelText('Code');
    fireEvent.change(input, { target: { value: 'abcd-efgh' } });
    expect(input).toHaveValue('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('approve-card-stub')).toBeInTheDocument();
    expect(h.credentials.at(-1)).toEqual({ code: 'ABCDEFGH' });
  });

  it('a code of the wrong shape never reaches the server', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Codes are 8 letters and digits/)).toBeInTheDocument();
    expect(screen.queryByTestId('approve-card-stub')).toBeNull();
  });

  it('lists recent sign-ins with the network line', async () => {
    recentBody = { signIns: [
      { id: 'a', device: 'Ember on Android Automotive', at: '2026-10-07 10:00:00.000Z', sameNetwork: true },
      { id: 'b', device: 'Chrome on Windows', at: '2026-10-06 10:00:00.000Z', sameNetwork: false },
    ] };
    await mount();
    expect(await screen.findByText('Ember on Android Automotive')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText(/Different network/)).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    await mount();
    expect(await screen.findByText('No devices signed in with a code yet.')).toBeInTheDocument();
  });

  it('Sign out everywhere asks first, then signs out everywhere and here', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(screen.getByText(/every device signed in to your account/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.url.endsWith('/revoke-all'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, sign out everywhere' }));
    });
    const call = calls.find((c) => c.url.endsWith('/revoke-all'))!;
    expect(call.init?.method).toBe('POST');
    expect((call.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    await waitFor(() => expect(h.signOut).toHaveBeenCalled());
  });

  it('a failed sign out everywhere says so and keeps you here', async () => {
    revokeStatus = 503;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, sign out everywhere' }));
    });
    expect(await screen.findByText(/Couldn't sign out everywhere/)).toBeInTheDocument();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
