import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { noneAdapter, type CacheAdapter } from '@/lib/autoCache/adapter';
import type { PinStatus } from '@/lib/offlineNative';
import { AUTO_CACHE_UPDATE_APP_TEXT } from '@/components/settings/AutoCacheSettings';
import { DOWNLOADS_BROWSER_TEXT, DOWNLOADS_NATIVE_TEXT } from '@/components/settings/useDownloadsSettings';
import { DownloadsSection } from './DownloadsSection';

const offline = vi.hoisted(() => ({
  native: false,
  clearAllDownloads: vi.fn(async () => {}),
  nativeRetry: vi.fn(async () => ({ pins: [], trackFiles: {}, totalBytes: 0 })),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={String(href)} {...rest}>{children}</a>,
}));
vi.mock('@/lib/offline', () => ({ clearAllDownloads: offline.clearAllDownloads, downloadPlaylist: vi.fn(), pinList: vi.fn() }));
vi.mock('@/lib/offlineNative', () => ({ nativeRetry: offline.nativeRetry, useNativeOfflinePresent: () => offline.native }));
// The confirm as plain elements: this test is about the section's wiring.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, title, confirmLabel, onConfirm }: { open: boolean; title: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> }) =>
    open ? (
      <div role="dialog" aria-label={String(title)}>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MB = 1024 * 1024;
const clearCache = vi.fn(async () => {});
const adapter: CacheAdapter = { ...noneAdapter, kind: 'opfs', clear: clearCache, stats: () => ({ bytes: 42 * MB, count: 3, cap: 0 }) };
const pin = (over: Partial<PinStatus>): PinStatus => ({ id: 'playlist:p1', name: 'Road trip', total: 10, done: 10, failed: 0, downloading: false, trackIds: [], ...over });

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DownloadsSection />
    </QueryClientProvider>,
  );
const group = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
  offline.native = false;
  useOfflineStore.setState({ downloaded: ['a'], pins: [], totalBytes: 150 * MB });
  useSettingsStore.setState({ autoCacheEnabled: true });
  useAutoCacheStore.setState({ adapter, supported: true, needsAppUpdate: false, stats: adapter.stats(), cancelInFlight: null });
});

describe('desktop Settings > Downloads as rows', () => {
  it('has Storage, Downloads and Automatic caching groups, with no cards', () => {
    renderSection();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Storage', 'Downloads', 'Automatic caching']);
    const bar = within(group('Storage')).getByTestId('storage-bar');
    expect(bar).not.toHaveClass('bg-card');
    expect(within(bar).getByTestId('storage-total')).toHaveTextContent('192.0 MB');
    expect(within(group('Storage')).getByText(DOWNLOADS_BROWSER_TEXT)).toBeInTheDocument();
    for (const g of document.querySelectorAll('[data-settings-group]')) {
      expect(g).not.toHaveClass('bg-card');
      expect(g).not.toHaveClass('divide-y');
    }
    expect(document.querySelector('.shadow-soft')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear all downloads' })).toBeEnabled();
    expect(screen.queryByText('No downloads yet')).toBeNull();
  });

  it('with nothing downloaded, says so as a row with the way to Library, and Clear stays disabled', () => {
    useOfflineStore.setState({ downloaded: [], pins: [], totalBytes: 0 });
    renderSection();
    const downloads = group('Downloads');
    expect(within(downloads).getByText('No downloads yet')).toBeInTheDocument();
    expect(within(downloads).getByRole('link', { name: 'Go to Library' })).toHaveAttribute('href', '/library');
    expect(within(downloads).getByRole('button', { name: 'Clear all downloads' })).toBeDisabled();
  });

  it('Clear all downloads asks first, then clears', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all downloads' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear all downloads?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear downloads' }));
    await waitFor(() => expect(offline.clearAllDownloads).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('in the apps, lists each pin as a row with its progress, and Retry where songs failed', async () => {
    offline.native = true;
    useOfflineStore.setState({
      downloaded: [],
      pins: [pin({}), pin({ id: 'playlist:p2', name: 'Gym', done: 7, failed: 3, failedReason: 'storage' })],
    });
    renderSection();
    expect(screen.getByText(DOWNLOADS_NATIVE_TEXT)).toBeInTheDocument();
    const downloads = group('Downloads');
    expect(within(downloads).getByText('10/10 downloaded')).toBeInTheDocument();
    expect(within(downloads).getByText('7/10 downloaded, 3 failed (Not enough storage)')).toBeInTheDocument();
    expect(within(downloads).getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    fireEvent.click(within(downloads).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(offline.nativeRetry).toHaveBeenCalledWith('playlist:p2'));
  });

  it('the automatic cache: the same switch, totals and Clear as the phone', async () => {
    renderSection();
    const cache = group('Automatic caching');
    fireEvent.click(within(cache).getByRole('switch', { name: 'Turn off Cache upcoming songs' }));
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(false);
    expect(within(cache).getByTestId('auto-cache-stats')).toHaveTextContent('Cached: 42.0 MB, 3 songs');
    fireEvent.click(within(cache).getByRole('button', { name: 'Clear cached songs' }));
    await waitFor(() => expect(clearCache).toHaveBeenCalled());
  });

  it('an app too old for the cache says to update it, with the switch disabled', () => {
    useAutoCacheStore.setState({ adapter: noneAdapter, supported: false, needsAppUpdate: true });
    renderSection();
    const cache = group('Automatic caching');
    expect(within(cache).getByText(AUTO_CACHE_UPDATE_APP_TEXT)).toBeInTheDocument();
    expect(within(cache).getByRole('switch', { name: 'Turn off Cache upcoming songs' })).toBeDisabled();
    expect(within(cache).queryByRole('button', { name: 'Clear cached songs' })).toBeNull();
  });
});
