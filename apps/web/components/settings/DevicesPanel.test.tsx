import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Settings > Devices (plan 1c): type a code to approve (the approve
 *  sheet opens over the page), the recent QR sign-ins with the device just
 *  approved lit up at the top, and Sign out everywhere. */

const h = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ signOut: h.signOut, user: { id: 'u1', email: 'r@x' } }) }));

const { DevicesPanel } = await import('./DevicesPanel');
const { useUiStore } = await import('@/stores/useUiStore');

let recentBody: unknown = { signIns: [] };
let revokeStatus = 200;
const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  h.signOut.mockClear();
  useUiStore.setState({ approveRequest: null, justApproved: null });
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
  it('Type the code: upper-cases as you type and opens the approve sheet with the code', async () => {
    await mount();
    const input = screen.getByLabelText('Code');
    fireEvent.change(input, { target: { value: 'abcd-efgh' } });
    expect(input).toHaveValue('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(useUiStore.getState().approveRequest?.credential).toEqual({ code: 'ABCDEFGH' });
  });

  it('a code of the wrong shape never reaches the server', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Codes are 8 letters and digits/)).toBeInTheDocument();
    expect(useUiStore.getState().approveRequest).toBeNull();
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

  it('the device just approved is at the top, lit up and marked New, even before the server lists it', async () => {
    recentBody = { signIns: [{ id: 'old', device: 'Safari on iPad', at: '2026-10-06 10:00:00.000Z', sameNetwork: true }] };
    useUiStore.setState({ justApproved: { id: 'req1', device: 'Chrome on Windows', sameNetwork: true, at: Date.now() } });
    await mount();
    await screen.findByText('Safari on iPad');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-testid', 'device-new');
    expect(rows[0]).toHaveTextContent('Chrome on Windows');
    expect(rows[0]).toHaveTextContent('Just now');
    expect(rows[0]).toHaveTextContent('New');
    expect(rows[0].className).toContain('ember-just-approved');
    expect(rows[1].className).not.toContain('ember-just-approved');
    // Taken once: it does not light up again next time.
    expect(useUiStore.getState().justApproved).toBeNull();
  });

  it('once the server lists it, its own row is the one on top, not twice', async () => {
    recentBody = { signIns: [
      { id: 'old', device: 'Safari on iPad', at: '2026-10-06 10:00:00.000Z', sameNetwork: true },
      { id: 'req1', device: 'Chrome on Windows', at: '2026-10-07 10:00:00.000Z', sameNetwork: false },
    ] };
    useUiStore.setState({ justApproved: { id: 'req1', device: 'Chrome on Windows', sameNetwork: true, at: Date.now() } });
    await mount();
    await screen.findByText('Safari on iPad');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-testid', 'device-new');
    expect(rows[0]).toHaveTextContent('Different network');
  });

  it('a device approved while already on the page lights up too', async () => {
    await mount();
    await screen.findByText('No devices signed in with a code yet.');
    await act(async () => useUiStore.setState({ justApproved: { id: 'r2', device: 'Ember desktop on macOS', sameNetwork: true, at: Date.now() } }));
    expect(screen.getByTestId('device-new')).toHaveTextContent('Ember desktop on macOS');
    expect(screen.queryByText('No devices signed in with a code yet.')).toBeNull();
  });

  it('no highlight without a fresh approval', async () => {
    recentBody = { signIns: [{ id: 'old', device: 'Safari on iPad', at: '2026-10-06 10:00:00.000Z', sameNetwork: true }] };
    await mount();
    await screen.findByText('Safari on iPad');
    expect(screen.queryByTestId('device-new')).toBeNull();
  });
});
