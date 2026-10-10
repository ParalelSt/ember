import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NativeScan } from '@/lib/qrScan/nativeScan';
import type { ScannedCredential } from '@/lib/qrScan/parseScanned';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  toastError: vi.fn(),
  native: { status: 'unavailable' } as NativeScan,
  scanner: null as null | { onResult: (c: ScannedCredential) => void; onClose: () => void; onTypeCode?: () => void },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: h.replace }) }));
vi.mock('sonner', () => ({ toast: { error: h.toastError } }));
vi.mock('@/lib/qrScan/nativeScan', () => ({ nativeScanQr: vi.fn(async () => h.native) }));
vi.mock('@/components/auth/QrScanner', () => ({
  QrScanner: (props: NonNullable<typeof h.scanner>) => {
    h.scanner = props;
    return <div data-testid="qr-scanner-stub" />;
  },
}));

const { QrScanHost } = await import('./QrScanHost');
const { ScanQrButton } = await import('./ScanQrButton');
const { useUiStore } = await import('@/stores/useUiStore');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
const ORIGIN = window.location.origin;

beforeEach(() => {
  vi.clearAllMocks();
  h.scanner = null;
  h.native = { status: 'unavailable' };
  useUiStore.setState({ qrScan: 'idle', approveRequest: null });
});
afterEach(cleanup);

async function start() {
  render(<QrScanHost />);
  await act(async () => {
    useUiStore.getState().setQrScan('native');
  });
}

describe('QrScanHost, Android app scanner', () => {
  it('a sign-in link for this server opens the approve sheet over this page, the token never in a URL', async () => {
    h.native = { status: 'scanned', value: `${ORIGIN}/link/${TOKEN}` };
    await start();
    expect(useUiStore.getState().approveRequest?.credential).toEqual({ token: TOKEN });
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(TOKEN);
    expect(useUiStore.getState().qrScan).toBe('idle');
    expect(screen.queryByTestId('qr-scanner-stub')).toBeNull();
  });

  it('a short code opens the approve sheet too', async () => {
    h.native = { status: 'scanned', value: 'ABCD-EFGH' };
    await start();
    expect(useUiStore.getState().approveRequest?.credential).toEqual({ code: 'ABCDEFGH' });
    expect(h.push).not.toHaveBeenCalled();
  });

  it('anything else: "That\'s not an Ember sign-in code", and no navigation', async () => {
    h.native = { status: 'scanned', value: `https://evil.example.com/link/${TOKEN}` };
    await start();
    expect(h.toastError).toHaveBeenCalledWith("That's not an Ember sign-in code");
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('cancelled: nothing happens', async () => {
    h.native = { status: 'cancelled' };
    await start();
    expect(useUiStore.getState().qrScan).toBe('idle');
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('qr-scanner-stub')).toBeNull();
  });
});

describe('QrScanHost, page scanner (no native scanner)', () => {
  it('opens the page scanner on its own history entry', async () => {
    const before = window.history.length;
    await start();
    expect(screen.getByTestId('qr-scanner-stub')).toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);
    expect((window.history.state as Record<string, unknown>).__emberQrScan).toBe(true);
  });

  it('a result opens the approve sheet and leaves the scanner entry for it to take over (no back() race)', async () => {
    await start();
    const back = vi.spyOn(window.history, 'back');
    act(() => h.scanner!.onResult({ kind: 'token', token: TOKEN }));
    expect(useUiStore.getState().approveRequest?.credential).toEqual({ token: TOKEN });
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect((window.history.state as Record<string, unknown>).__emberQrScan).toBe(true);
    expect(screen.queryByTestId('qr-scanner-stub')).toBeNull();
    back.mockRestore();
  });

  it('closing goes back off the scanner entry', async () => {
    await start();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    act(() => h.scanner!.onClose());
    expect(back).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().qrScan).toBe('idle');
    back.mockRestore();
  });

  it('Back (popstate) closes it', async () => {
    await start();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByTestId('qr-scanner-stub')).toBeNull();
  });

  it('No camera? Type the code: Settings > Devices, replacing the scanner entry', async () => {
    await start();
    act(() => h.scanner!.onTypeCode!());
    expect(h.replace).toHaveBeenCalledWith('/settings/devices');
  });
});

describe('ScanQrButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('is not there on a desktop browser', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    );
    await act(async () => {
      render(<ScanQrButton />);
    });
    expect(screen.queryByTestId('scan-qr')).toBeNull();
  });

  it('is not there in the desktop app', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    try {
      await act(async () => {
        render(<ScanQrButton look="nav" />);
      });
      expect(screen.queryByTestId('scan-qr')).toBeNull();
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it('is not there on a car screen', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Safari/537.36 EmberCar',
    );
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    await act(async () => {
      render(<ScanQrButton look="nav" />);
    });
    expect(screen.queryByTestId('scan-qr')).toBeNull();
  });

  it('in the Android app: shows, closes the drawer first, and starts a scan', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    );
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const close = vi.fn();
    await act(async () => {
      render(<ScanQrButton look="nav" onBeforeStart={close} />);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan QR code' }));
    expect(close).toHaveBeenCalled();
    expect(useUiStore.getState().qrScan).toBe('native');
  });

  it('in an iPhone browser with a camera API: shows', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    );
    const md = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices');
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
    try {
      await act(async () => {
        render(<ScanQrButton />);
      });
      expect(screen.getByRole('button', { name: 'Scan QR code' })).toBeInTheDocument();
    } finally {
      if (md) Object.defineProperty(window.navigator, 'mediaDevices', md);
      else delete (window.navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    }
  });
});
