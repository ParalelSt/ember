import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { QrSignInState } from '@/hooks/useQrSignIn';

/** The QR block on /auth (plan 1a): each state's copy, and approval
 *  signing the device in and moving on. */

const h = vi.hoisted(() => ({
  state: { kind: 'starting' } as QrSignInState,
  restart: vi.fn(),
  onApproved: null as null | ((token: string, record: { id: string } & Record<string, unknown>) => void),
  shell: '' as string,
  adoptSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/hooks/useQrSignIn', () => ({
  useQrSignIn: (opts: { shell: string; onApproved: typeof h.onApproved }) => {
    h.onApproved = opts.onApproved;
    h.shell = opts.shell;
    return { state: h.state, restart: h.restart };
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ adoptSession: h.adoptSession }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, refresh: h.refresh }) }));

const { QrSignIn } = await import('./QrSignIn');

const waiting: QrSignInState = {
  kind: 'waiting',
  id: 'req000000000001',
  code: 'ABCDEFGH',
  approveUrl: 'https://ember.example/link/tttttttttttttttttttttttttttttttttttttttttt1',
  device: 'Ember on Android Automotive',
  expiresAtMs: Date.now() + 180_000,
  offline: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.state = { kind: 'starting' };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QrSignIn', () => {
  it('waiting: the QR of the link, the grouped code, the device and the wait line', () => {
    h.state = waiting;
    render(<QrSignIn next="/" />);
    expect(screen.getByText('Sign in with your phone')).toBeInTheDocument();
    expect(screen.getByTestId('qr')).toBeInTheDocument();
    expect(screen.getByTestId('qr-code')).toHaveTextContent('ABCD-EFGH');
    expect(screen.getByText(/This device: Ember on Android Automotive/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument();
    expect(screen.getByText(/Settings > Devices > Type the code/)).toBeInTheDocument();
    expect(h.shell).toBe('web');
  });

  it('waiting but unreachable: the QR stays and it says it is retrying', () => {
    h.state = { ...waiting, offline: true };
    render(<QrSignIn next="/" />);
    expect(screen.getByTestId('qr')).toBeInTheDocument();
    expect(screen.getByText(/Can't reach Ember, retrying/)).toBeInTheDocument();
  });

  it('expired (after the silent renewals): Get a new code', () => {
    h.state = { kind: 'expired' };
    render(<QrSignIn next="/" />);
    expect(screen.getByText('Code expired')).toBeInTheDocument();
    expect(screen.queryByTestId('qr')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }));
    expect(h.restart).toHaveBeenCalled();
  });

  it('denied: says so, Try again starts a new request', () => {
    h.state = { kind: 'denied' };
    render(<QrSignIn next="/" />);
    expect(screen.getByText('Sign-in was declined on your other device.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.restart).toHaveBeenCalled();
  });

  it('a failed start: a quiet line and Try again, the email form above is unaffected', () => {
    h.state = { kind: 'error' };
    render(<QrSignIn next="/" />);
    expect(screen.getByText(/Can't get a code right now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.restart).toHaveBeenCalled();
  });

  it('approved: adopts the session, says who, then goes on to next', () => {
    vi.useFakeTimers();
    h.state = waiting;
    const { rerender } = render(<QrSignIn next="/library" />);
    act(() => h.onApproved!('minted', { id: 'u1', name: 'Robin' }));
    expect(h.adoptSession).toHaveBeenCalledWith('minted', { id: 'u1', name: 'Robin' });
    h.state = { kind: 'approved', name: 'Robin' };
    rerender(<QrSignIn next="/library" />);
    expect(screen.getByText('Signed in as Robin')).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(h.replace).toHaveBeenCalledWith('/library');
    expect(h.refresh).toHaveBeenCalled();
  });
});
