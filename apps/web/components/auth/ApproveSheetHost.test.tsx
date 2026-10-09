import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { QrFacts } from '@/lib/qrLogin/client';

/** The approve sheet in the app shell: opened from the store (Scan QR code,
 *  a typed code), its own Back entry (or the scanner's, taken over), and
 *  after Approve, Settings > Devices with the new device waiting to be lit. */

type SheetProps = { credential: unknown; onClose: () => void; onApproved: (facts: QrFacts) => void };
const h = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: '/library',
  sheet: null as null | SheetProps,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
  usePathname: () => h.pathname,
}));
vi.mock('@/components/auth/ApproveSheet', () => ({
  ApproveSheet: (props: SheetProps) => {
    h.sheet = props;
    return <div data-testid="sheet-stub">{JSON.stringify(props.credential)}</div>;
  },
}));

const { ApproveSheetHost, SHEET_MARK, SCAN_MARK } = await import('./ApproveSheetHost');
const { useUiStore } = await import('@/stores/useUiStore');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const FACTS: QrFacts = { id: 'req1', device: 'Chrome on Windows', shell: 'web', askedSecondsAgo: 3, sameNetwork: true, status: 'pending' };
const state = () => (window.history.state ?? {}) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.pathname = '/library';
  h.sheet = null;
  useUiStore.setState({ approveRequest: null, justApproved: null });
  window.history.replaceState(null, '', '/library');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openWith(credential: { token: string } | { code: string }) {
  render(<ApproveSheetHost />);
  await act(async () => useUiStore.getState().openApprove(credential));
}

describe('ApproveSheetHost', () => {
  it('shows nothing until a request comes in', () => {
    render(<ApproveSheetHost />);
    expect(screen.queryByTestId('sheet-stub')).toBeNull();
  });

  it('opens the sheet over the page on its own history entry, the URL unchanged', async () => {
    const before = window.history.length;
    await openWith({ token: TOKEN });
    expect(h.sheet!.credential).toEqual({ token: TOKEN });
    expect(window.history.length).toBe(before + 1);
    expect(state()[SHEET_MARK]).toBe(true);
    expect(window.location.pathname).toBe('/library');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("takes over the page scanner's entry instead of pushing a second one", async () => {
    window.history.pushState({ [SCAN_MARK]: true }, '', '/library');
    const before = window.history.length;
    await openWith({ code: 'ABCDEFGH' });
    expect(window.history.length).toBe(before);
    expect(state()[SHEET_MARK]).toBe(true);
    expect(state()[SCAN_MARK]).toBeUndefined();
  });

  it('closing goes back off its entry', async () => {
    await openWith({ code: 'ABCDEFGH' });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => h.sheet!.onClose());
    expect(back).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().approveRequest).toBeNull();
    expect(screen.queryByTestId('sheet-stub')).toBeNull();
  });

  it('Back (popstate) closes it', async () => {
    await openWith({ code: 'ABCDEFGH' });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByTestId('sheet-stub')).toBeNull();
  });

  it('Approve: Settings > Devices REPLACES the sheet entry, with the device waiting to be lit up', async () => {
    await openWith({ token: TOKEN });
    const back = vi.spyOn(window.history, 'back');
    act(() => h.sheet!.onApproved(FACTS));
    expect(h.replace).toHaveBeenCalledWith('/settings/devices');
    expect(h.push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(useUiStore.getState().justApproved).toMatchObject({ id: 'req1', device: 'Chrome on Windows', sameNetwork: true });
    expect(screen.queryByTestId('sheet-stub')).toBeNull();
  });

  it('Approve while already on Settings > Devices: no navigation, just off the sheet entry', async () => {
    h.pathname = '/settings/devices';
    await openWith({ code: 'ABCDEFGH' });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => h.sheet!.onApproved(FACTS));
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().justApproved?.id).toBe('req1');
  });

  it('a link in the sheet that goes to another page closes it', async () => {
    const { rerender } = render(<ApproveSheetHost />);
    await act(async () => useUiStore.getState().openApprove({ token: TOKEN }));
    h.pathname = '/settings/devices';
    await act(async () => rerender(<ApproveSheetHost />));
    expect(useUiStore.getState().approveRequest).toBeNull();
  });

  it('the same code again is a fresh sheet', async () => {
    await openWith({ code: 'ABCDEFGH' });
    const first = useUiStore.getState().approveRequest!.n;
    await act(async () => useUiStore.getState().openApprove({ code: 'ABCDEFGH' }));
    expect(useUiStore.getState().approveRequest!.n).toBe(first + 1);
  });
});
