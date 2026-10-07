import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/** The approve card (plan 1b): the facts to spot a fake, Approve dead for
 *  2 s, Not me, and each result. */

const h = vi.hoisted(() => ({ user: { id: 'u1', email: 'robin@ember.test', isAdmin: false } }));
vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: h.user, isAdmin: h.user.isAdmin }) }));

const { ApproveSignIn } = await import('./ApproveSignIn');

type Route = 'lookup' | 'approve' | 'deny';
let answers: Partial<Record<Route, { status: number; body: unknown }>> = {};
const calls: Array<{ route: string; body: unknown; init: RequestInit }> = [];
const facts = (over: Record<string, unknown> = {}) => ({
  id: 'req000000000001', device: 'Ember on Android Automotive', shell: 'capacitor', askedSecondsAgo: 40, sameNetwork: true, status: 'pending', ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  h.user = { id: 'u1', email: 'robin@ember.test', isAdmin: false };
  answers = { lookup: { status: 200, body: facts() }, approve: { status: 200, body: { ok: true } }, deny: { status: 200, body: { ok: true } } };
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const route = String(url).split('/').pop() as Route;
    calls.push({ route, body: JSON.parse(String(init.body)), init });
    const a = answers[route]!;
    return new Response(JSON.stringify(a.body), { status: a.status });
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function show(credential: { token: string } | { code: string } = { token: 'T'.repeat(43) }) {
  render(<ApproveSignIn credential={credential} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
const approveBtn = () => screen.getByRole('button', { name: 'Approve' });

describe('ApproveSignIn', () => {
  it('looks the request up with the credential, as a JSON POST', async () => {
    await show();
    expect(calls[0]).toMatchObject({ route: 'lookup', body: { token: 'T'.repeat(43) } });
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('shows the device, the age, the network and whose account it signs in', async () => {
    await show();
    expect(screen.getByText('Sign in on another device?')).toBeInTheDocument();
    // The label comes from the device itself, and the card says so.
    expect(screen.getByText('Says it is: Ember on Android Automotive')).toBeInTheDocument();
    expect(screen.getByText('Asked 40 s ago')).toBeInTheDocument();
    const net = screen.getByText('Same network as this phone');
    expect(net.className).not.toMatch(/destructive/);
    expect(screen.getByText(/Only approve if that screen is in front of you right now/)).toBeInTheDocument();
    expect(screen.getByTestId('approve-account')).toHaveTextContent('robin@ember.test');
    expect(screen.getByTestId('approve-account')).not.toHaveTextContent('(admin)');
  });

  it('warns about a different network', async () => {
    answers.lookup = { status: 200, body: facts({ sameNetwork: false, askedSecondsAgo: 130 }) };
    await show();
    const net = screen.getByText('Different network from this phone');
    expect(net.className).toMatch(/text-destructive/);
    expect(screen.getByText('Asked 2 min ago')).toBeInTheDocument();
  });

  it('says (admin) after an admin\'s email', async () => {
    h.user = { id: 'u1', email: 'owner@ember.test', isAdmin: true };
    await show();
    expect(screen.getByTestId('approve-account')).toHaveTextContent('owner@ember.test (admin)');
  });

  it('Approve is dead for the first 2 s', async () => {
    await show();
    expect(approveBtn()).toBeDisabled();
    fireEvent.click(approveBtn());
    expect(calls.filter((c) => c.route === 'approve')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(approveBtn()).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(approveBtn()).toBeEnabled();
  });

  it('approves with the id and the credential, then says done', async () => {
    await show({ code: 'ABCDEFGH' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      fireEvent.click(approveBtn());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.find((c) => c.route === 'approve')?.body).toEqual({ id: 'req000000000001', code: 'ABCDEFGH' });
    expect(screen.getByText('Done. The other device is signing in.')).toBeInTheDocument();
  });

  it.each([
    ['expired', 'This code has expired, ask the device for a new one.'],
    ['used', 'This code was already used.'],
    ['denied', 'Declined.'],
  ])('an approve answered 409 %s says so', async (status, text) => {
    answers.approve = { status: 409, body: { status } };
    await show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      fireEvent.click(approveBtn());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('Not me denies at once and says declined', async () => {
    await show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not me' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.find((c) => c.route === 'deny')?.body).toEqual({ id: 'req000000000001', token: 'T'.repeat(43) });
    expect(screen.getByText('Declined.')).toBeInTheDocument();
  });

  it('a request approved a moment ago, or one the server no longer knows, says so without a card', async () => {
    answers.lookup = { status: 200, body: facts({ status: 'approved' }) };
    await show();
    expect(screen.getByText('This code was already used.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    cleanup();
    answers.lookup = { status: 404, body: { error: 'No sign-in request with that code.' } };
    await show();
    expect(screen.getByText('This code has expired or was already used. Ask the device for a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Have a code/ })).toHaveAttribute('href', '/settings/devices');
  });

  it('too many tries says to wait', async () => {
    answers.lookup = { status: 429, body: { error: 'Slow down' } };
    await show();
    expect(screen.getByText(/Too many tries/)).toBeInTheDocument();
  });
});
