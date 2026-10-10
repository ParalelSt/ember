import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/** The approve sheet (owner's pick: a bottom sheet over the page): the
 *  device facts, Approve dead for the first 2 s, Approve handing over to
 *  the caller, Not me declining with a toast, and dismissing NOT declining. */

const h = vi.hoisted(() => ({ toast: vi.fn(), dismiss: null as null | ((open: boolean) => void) }));
// base-ui's Dialog cannot run under the unit tests' React (test-utils/
// dialogMock.tsx): the stand-in keeps the side and hands over onOpenChange,
// which is what the scrim, Escape and Back call.
vi.mock('@/components/ui/sheet', async () => {
  const real = await import('@/test-utils/dialogMock');
  return {
    ...real,
    Sheet: (props: ComponentProps<typeof real.Sheet>) => {
      h.dismiss = props.onOpenChange ?? null;
      return <real.Sheet {...props} />;
    },
    SheetContent: ({ side, ...rest }: ComponentProps<typeof real.SheetContent>) => <real.SheetContent {...rest} data-side={side} />,
  };
});
vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'robin@ember.test' }, isAdmin: false }),
}));

const { ApproveSheet, DECLINED_TOAST } = await import('./ApproveSheet');

type Route = 'lookup' | 'approve' | 'deny';
let answers: Partial<Record<Route, { status: number; body: unknown }>> = {};
const calls: Array<{ route: string; body: unknown }> = [];
const FACTS = { id: 'req000000000001', device: 'Chrome on Windows', shell: 'web', askedSecondsAgo: 12, sameNetwork: true, status: 'pending' };

const onClose = vi.fn();
const onApproved = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  onClose.mockReset();
  onApproved.mockReset();
  h.toast.mockReset();
  answers = { lookup: { status: 200, body: FACTS }, approve: { status: 200, body: { ok: true } }, deny: { status: 200, body: { ok: true } } };
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const route = String(url).split('/').pop() as Route;
    calls.push({ route, body: JSON.parse(String(init.body)) });
    const a = answers[route]!;
    return new Response(JSON.stringify(a.body), { status: a.status });
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  render(<ApproveSheet credential={{ token: 'T'.repeat(43) }} onClose={onClose} onApproved={onApproved} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
const approveBtn = () => screen.getByRole('button', { name: 'Approve' });
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ApproveSheet', () => {
  it('is a dialog over the page with the device, its browser and OS, the time and the account', async () => {
    await open();
    const sheet = screen.getByRole('dialog', { name: 'Sign in on another device?' });
    expect(sheet).toHaveAttribute('data-side', 'bottom');
    expect(screen.getByTestId('approve-device')).toHaveTextContent('Windows PC');
    expect(screen.getByText(/^Says it is Chrome on Windows/)).toBeInTheDocument();
    expect(screen.getByText('Asked 12 s ago')).toBeInTheDocument();
    expect(screen.getByText('Same network as this phone')).toBeInTheDocument();
    expect(screen.getByTestId('approve-account')).toHaveTextContent('robin@ember.test');
    expect(screen.getByRole('button', { name: 'Not me' })).toBeInTheDocument();
  });

  it('Approve is enabled only after the short delay', async () => {
    await open();
    expect(approveBtn()).toBeDisabled();
    fireEvent.click(approveBtn());
    await tick(1999);
    expect(approveBtn()).toBeDisabled();
    expect(calls.some((c) => c.route === 'approve')).toBe(false);
    await tick(1);
    expect(approveBtn()).toBeEnabled();
  });

  it('Approve sends the id and the token, then hands the facts to the caller', async () => {
    await open();
    await tick(2000);
    fireEvent.click(approveBtn());
    await tick(0);
    expect(calls.find((c) => c.route === 'approve')?.body).toEqual({ id: FACTS.id, token: 'T'.repeat(43) });
    expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ id: FACTS.id, device: 'Chrome on Windows', sameNetwork: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Not me declines at once (no delay), closes, and says so in a toast', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Not me' }));
    await tick(0);
    expect(calls.find((c) => c.route === 'deny')?.body).toEqual({ id: FACTS.id, token: 'T'.repeat(43) });
    expect(h.toast).toHaveBeenCalledWith(DECLINED_TOAST);
    expect(onClose).toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('dismissing (scrim, Escape, Back) only closes: nothing is declined or approved', async () => {
    await open();
    act(() => h.dismiss!(false));
    await tick(0);
    expect(onClose).toHaveBeenCalled();
    expect(calls.map((c) => c.route)).toEqual(['lookup']);
  });

  it('an approve that fails stays in the sheet with the reason and a Close button', async () => {
    answers.approve = { status: 409, body: { status: 'expired' } };
    await open();
    await tick(2000);
    fireEvent.click(approveBtn());
    await tick(0);
    expect(screen.getByText('This code has expired, ask the device for a new one.')).toBeInTheDocument();
    expect(onApproved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
