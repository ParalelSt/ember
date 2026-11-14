import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/** Desktop Settings > Devices as rows: the same sign-in, device list and
 *  Sign out everywhere as the phone panel (DevicesPanel.test covers its
 *  flows in depth), drawn as groups of rows without cards. */

const h = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  canScan: false,
  appVersion: null as string | null,
  android: false,
  setBootStart: vi.fn(async (s: { enabled: boolean; keepPlaying: boolean }) => s),
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ signOut: h.signOut, user: { id: 'u1', email: 'r@x' } }) }));
vi.mock('@/lib/bootStart', () => ({
  isAndroidApp: () => h.android,
  bootStartSupported: () => h.android,
  getBootStart: async () => ({ enabled: true, keepPlaying: false }),
  setBootStart: h.setBootStart,
}));
vi.mock('@/hooks/useHeadUnit', () => ({ useIsHeadUnit: () => false }));
vi.mock('@/hooks/useQrScan', () => ({ useCanScan: () => h.canScan }));
vi.mock('@/lib/shellVersion', () => ({ shellAppVersion: async () => h.appVersion }));
// base-ui's dialog brings the root's second React into a test render (see
// QueueSheet.test.tsx): plain boxes that show while open.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId}>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-kind="centered" data-testid={testId}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
// Desktop Settings is lg and up: the confirm is the centered dialog.
const screenSize = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => screenSize.desktop }));

const { DevicesSection } = await import('./DevicesSection');
const { useUiStore } = await import('@/stores/useUiStore');

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const realUa = navigator.userAgent;

let recentBody: unknown = { signIns: [] };
let revokeStatus = 200;
const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  h.signOut.mockClear();
  h.canScan = false;
  h.appVersion = null;
  h.android = false;
  Object.defineProperty(navigator, 'userAgent', { value: MAC_CHROME, configurable: true });
  localStorage.clear();
  useUiStore.setState({ approveRequest: null, justApproved: null, qrScan: 'idle' });
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
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, 'userAgent', { value: realUa, configurable: true });
});

async function mount() {
  await act(async () => {
    render(<DevicesSection />);
  });
}
const group = (name: string) => screen.getByRole('region', { name });

const TWO = { signIns: [
  { id: 'a', device: 'Ember on Android Automotive', at: '2026-10-07 10:00:00.000Z', sameNetwork: true },
  { id: 'b', device: 'Chrome on Windows', at: '2026-10-06 10:00:00.000Z', sameNetwork: false },
] };

describe('desktop Settings > Devices as rows', () => {
  it('this device, sign in, other devices and the danger zone as titled groups, with no cards', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', 'abc123');
    h.appVersion = '0.7.40';
    await mount();
    expect(screen.getAllByRole('heading', { level: 3 }).map((x) => x.textContent)).toEqual([
      'This device', 'Sign in another device', 'Other devices', 'Danger zone',
    ]);
    const here = group('This device');
    expect(here).toHaveTextContent('Mac, Chrome');
    expect(here).toHaveTextContent('Active now');
    expect(here).toHaveTextContent('Web abc123');
    await waitFor(() => expect(here).toHaveTextContent('App 0.7.40'));
    expect(document.querySelector('.shadow-soft, .rounded-2xl, .bg-linear-to-br')).toBeNull();
    for (const g of document.querySelectorAll('[data-settings-group]')) expect(g).not.toHaveClass('bg-card');
    expect(screen.queryByTestId('head-unit-settings')).toBeNull();
  });

  it('without a camera the code entry is open; a typed code opens the approve sheet', async () => {
    await mount();
    const signIn = group('Sign in another device');
    expect(within(signIn).queryByTestId('scan-qr')).toBeNull();
    fireEvent.change(within(signIn).getByLabelText('Code'), { target: { value: 'abcd-efgh' } });
    expect(within(signIn).getByLabelText('Code')).toHaveValue('ABCD-EFGH');
    fireEvent.click(within(signIn).getByRole('button', { name: 'Continue' }));
    expect(useUiStore.getState().approveRequest?.credential).toEqual({ code: 'ABCDEFGH' });
  });

  it('a code of the wrong shape says so', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Codes are 8 letters and digits');
    expect(useUiStore.getState().approveRequest).toBeNull();
  });

  it('with a camera: Scan QR code opens the scanner, and the code entry is behind a button', async () => {
    h.canScan = true;
    await mount();
    expect(screen.queryByLabelText('Code')).toBeNull();
    fireEvent.click(screen.getByTestId('scan-qr'));
    expect(useUiStore.getState().qrScan).toBe('native');
    fireEvent.click(screen.getByRole('button', { name: 'Type the code instead' }));
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide code entry' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists the other devices as rows with a count, the fresh one on top and marked New', async () => {
    recentBody = TWO;
    useUiStore.setState({ justApproved: { id: 'req1', device: 'Safari on iPad', sameNetwork: true, at: Date.now() } });
    await mount();
    await screen.findAllByTestId('device-row');
    const others = group('Other devices');
    expect(within(others).getByTestId('other-count')).toHaveTextContent('3');
    const rows = within(others).getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-testid', 'device-new');
    expect(rows[0]).toHaveTextContent('New');
    expect(rows[0]).toHaveTextContent('Signed in just now');
    expect(rows[0].className).toContain('ember-just-approved');
    expect(rows[2]).toHaveTextContent('Windows PC, Chrome');
    expect(within(rows[2]).getByText('Different network')).toHaveClass('text-destructive');
  });

  it('says when there are no other devices', async () => {
    await mount();
    expect(await screen.findByText('No other devices signed in with a code yet.')).toBeInTheDocument();
  });

  it('Sign out everywhere asks in a centered dialog listing the devices, then signs out', async () => {
    recentBody = TWO;
    await mount();
    await screen.findAllByTestId('device-row');
    fireEvent.click(within(group('Danger zone')).getByRole('button', { name: 'Sign out everywhere' }));
    const box = screen.getByTestId('sign-out-everywhere-sheet');
    expect(box).toHaveAttribute('data-kind', 'centered');
    const chips = within(within(box).getByRole('list', { name: 'Devices that will be signed out' })).getAllByRole('listitem');
    expect(chips.map((c) => c.textContent)).toEqual(['This device', 'Car screen', 'Windows PC']);
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: 'Sign out all' }));
    });
    expect(calls.some((c) => c.url.endsWith('/revoke-all'))).toBe(true);
    await waitFor(() => expect(h.signOut).toHaveBeenCalled());
  });

  it('in the Android app, the head unit switches follow as rows', async () => {
    h.android = true;
    await mount();
    const car = group('Car head unit');
    expect(within(car).getByTestId('head-unit-help')).not.toHaveClass('bg-card');
    const boot = await within(car).findByRole('switch', { name: 'Turn off Open Ember when this device starts' });
    fireEvent.click(boot);
    await waitFor(() => expect(h.setBootStart).toHaveBeenCalledWith({ enabled: false, keepPlaying: false }));
  });
});
