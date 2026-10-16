import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/** Settings > Devices (owner's picks: this device on top, detail rows, big
 *  QR card, danger zone): the hero for this browser, the sign-in card (scan
 *  or type a code, the approve sheet opens over the page), the other
 *  devices with the one just approved lit up at the top, and Sign out
 *  everywhere behind a confirm sheet that lists the devices. */

const h = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  canScan: false,
  appVersion: null as string | null,
}));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ signOut: h.signOut, user: { id: 'u1', email: 'r@x' } }) }));
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

const { DevicesPanel } = await import('./DevicesPanel');
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
    render(<DevicesPanel />);
  });
}

const TWO = { signIns: [
  { id: 'a', device: 'Ember on Android Automotive', at: '2026-10-07 10:00:00.000Z', sameNetwork: true },
  { id: 'b', device: 'Chrome on Windows', at: '2026-10-06 10:00:00.000Z', sameNetwork: false },
] };

describe('DevicesPanel: layout', () => {
  it('this device on top, then sign in, then other devices, then the danger zone last', async () => {
    await mount();
    const order = ['this-device', 'signin-card', 'other-count', 'danger-zone'].map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('DevicesPanel: this device', () => {
  it('names the browser it is, marked Active now, with no made-up location', async () => {
    await mount();
    const hero = screen.getByTestId('this-device');
    expect(hero).toHaveTextContent('This device');
    expect(hero).toHaveTextContent('Mac, Chrome');
    expect(hero).toHaveTextContent('Active now');
    expect(hero.querySelector('.phosphor-laptop')).not.toBeNull();
    // No version known in a test browser, and no location anywhere.
    expect(hero).not.toHaveTextContent(/Web |App /);
  });

  it('shows the web build and the app version when they are known', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.20');
    h.appVersion = '0.4.14';
    await mount();
    const hero = screen.getByTestId('this-device');
    expect(hero).toHaveTextContent('Web 0.7.20');
    await waitFor(() => expect(hero).toHaveTextContent('App 0.4.14'));
  });

  it('a phone gets the phone icon', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', configurable: true });
    await mount();
    const hero = screen.getByTestId('this-device');
    expect(hero).toHaveTextContent('Android device, Chrome');
    expect(hero.querySelector('.phosphor-device-mobile')).not.toBeNull();
  });
});

describe('DevicesPanel: sign in another device', () => {
  it('on a phone: a big Scan QR code button opens the scanner', async () => {
    h.canScan = true;
    await mount();
    const card = screen.getByTestId('signin-card');
    expect(within(card).getByText('Sign in another device')).toBeInTheDocument();
    // Code entry waits behind its toggle.
    expect(screen.queryByLabelText('Code')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Scan QR code' }));
    expect(useUiStore.getState().qrScan).toBe('native');
  });

  it('Type the code instead reveals the code entry, and hides it again', async () => {
    h.canScan = true;
    await mount();
    const toggle = screen.getByRole('button', { name: 'Type the code instead' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    const hide = screen.getByRole('button', { name: 'Hide code entry' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('where scanning is not possible the code entry is simply open, no scan button', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: 'Scan QR code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Type the code instead' })).toBeNull();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
  });

  it('upper-cases as you type and opens the approve sheet with the code', async () => {
    h.canScan = true;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Type the code instead' }));
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
    expect(screen.getByRole('alert')).toHaveTextContent('Codes are 8 letters and digits, like ABCD-EFGH.');
    expect(useUiStore.getState().approveRequest).toBeNull();
  });
});

describe('DevicesPanel: other devices', () => {
  it('lists each with its icon, name, when it signed in and the network, and a count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:00:00.000Z'));
    try {
      recentBody = TWO;
      await mount();
      await waitFor(() => expect(screen.getByTestId('other-count')).toHaveTextContent('2'));
      const rows = screen.getAllByTestId('device-row');
      expect(rows[0]).toHaveTextContent('Car screen, Ember app');
      expect(rows[0]).toHaveTextContent('Signed in 2 days ago');
      expect(rows[0]).toHaveTextContent('Same network');
      expect(rows[0].querySelector('.phosphor-car')).not.toBeNull();
      expect(rows[1]).toHaveTextContent('Windows PC, Chrome');
      expect(rows[1]).toHaveTextContent('Signed in 3 days ago');
      expect(rows[1]).toHaveTextContent('Different network');
      expect(rows[1].querySelector('.phosphor-laptop')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows only what is known: no location, version, last active, or per-device sign out', async () => {
    recentBody = TWO;
    await mount();
    const rows = await screen.findAllByTestId('device-row');
    for (const row of rows) {
      expect(row).not.toHaveTextContent(/Active|Web |App /);
      expect(within(row).queryByRole('button')).toBeNull();
    }
  });

  it('says when there are none', async () => {
    await mount();
    expect(await screen.findByText('No other devices signed in with a code yet.')).toBeInTheDocument();
    expect(screen.getByTestId('other-count')).toHaveTextContent('0');
  });

  it("this browser's own QR sign-in is this device, not another", async () => {
    localStorage.setItem('ember-qr-signin', 'own000000000001');
    recentBody = { signIns: [
      { id: 'own000000000001', device: 'Chrome on macOS', at: '2026-10-07 10:00:00.000Z', sameNetwork: true },
      ...TWO.signIns,
    ] };
    await mount();
    await waitFor(() => expect(screen.getByTestId('other-count')).toHaveTextContent('2'));
    expect(screen.getAllByTestId('device-row').map((r) => r.textContent)).not.toContain(expect.stringContaining('Mac'));
  });

  it('the device just approved is at the top, lit up and marked New, even before the server lists it', async () => {
    recentBody = { signIns: [{ id: 'old', device: 'Safari on iPad', at: '2026-10-06 10:00:00.000Z', sameNetwork: true }] };
    useUiStore.setState({ justApproved: { id: 'req1', device: 'Chrome on Windows', sameNetwork: true, at: Date.now() } });
    await mount();
    await screen.findByText('iPad, Safari');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-testid', 'device-new');
    expect(rows[0]).toHaveTextContent('Windows PC, Chrome');
    expect(rows[0]).toHaveTextContent('Signed in just now');
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
    await screen.findByText('iPad, Safari');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-testid', 'device-new');
    expect(rows[0]).toHaveTextContent('Different network');
  });

  it('a device approved while already on the page lights up too', async () => {
    await mount();
    await screen.findByText('No other devices signed in with a code yet.');
    await act(async () => useUiStore.setState({ justApproved: { id: 'r2', device: 'Ember desktop on macOS', sameNetwork: true, at: Date.now() } }));
    expect(screen.getByTestId('device-new')).toHaveTextContent('Mac, Ember desktop app');
    expect(screen.queryByText('No other devices signed in with a code yet.')).toBeNull();
  });

  it('no highlight without a fresh approval', async () => {
    recentBody = { signIns: [{ id: 'old', device: 'Safari on iPad', at: '2026-10-06 10:00:00.000Z', sameNetwork: true }] };
    await mount();
    await screen.findByText('iPad, Safari');
    expect(screen.queryByTestId('device-new')).toBeNull();
  });
});

describe('DevicesPanel: danger zone', () => {
  it('is a red card with a shield warning at the bottom', async () => {
    await mount();
    const zone = screen.getByTestId('danger-zone');
    expect(zone).toHaveTextContent('Danger zone');
    expect(zone.querySelector('.phosphor-shield-warning')).not.toBeNull();
    expect(within(zone).getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument();
  });

  it('opens a sheet listing the devices that will be signed out; Cancel changes nothing', async () => {
    recentBody = TWO;
    await mount();
    await screen.findAllByTestId('device-row');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    const sheet = screen.getByTestId('sign-out-everywhere-sheet');
    expect(within(sheet).getByText('Sign out everywhere?')).toBeInTheDocument();
    const chips = within(within(sheet).getByRole('list', { name: 'Devices that will be signed out' })).getAllByRole('listitem');
    expect(chips.map((c) => c.textContent)).toEqual(['This device', 'Car screen', 'Windows PC']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('sign-out-everywhere-sheet')).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/revoke-all'))).toBe(false);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('Sign out all signs out everywhere and here', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out all' }));
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
      fireEvent.click(screen.getByRole('button', { name: 'Sign out all' }));
    });
    expect(await screen.findByText(/Couldn't sign out everywhere/)).toBeInTheDocument();
    expect(screen.getByTestId('sign-out-everywhere-sheet')).toBeInTheDocument();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
