import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DownloadsSettingsPage from './page';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/offline', () => ({ clearAllDownloads: vi.fn(), downloadPlaylist: vi.fn(), pinList: vi.fn() }));
vi.mock('@/lib/offlineNative', () => ({ nativeRetry: vi.fn(), useNativeOfflinePresent: () => false }));
vi.mock('@/components/settings/AutoCacheSettings', () => ({ AutoCacheSettings: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  useOfflineStore.setState({ downloaded: ['a'], pins: [], totalBytes: 150 * 1024 * 1024 });
  useAutoCacheStore.setState({ stats: { bytes: 42 * 1024 * 1024, count: 3, cap: 0 } });
});

describe('Settings > Downloads', () => {
  it('shows the total, the split key, and keeps Clear all downloads', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DownloadsSettingsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('storage-total')).toHaveTextContent('192.0 MB');
    expect(screen.getByText(/Downloads 150\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic cache 42\.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all downloads' })).toBeEnabled();
  });

  const page = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DownloadsSettingsPage />
      </QueryClientProvider>,
    );

  it('with nothing downloaded, says so with the way to Library, and Clear stays disabled', () => {
    useOfflineStore.setState({ downloaded: [], pins: [], totalBytes: 0 });
    page();
    expect(screen.getByRole('heading', { name: 'No downloads yet' })).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Library' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('button', { name: 'Clear all downloads' })).toBeDisabled();
  });

  it('with downloads, shows no empty state', () => {
    page();
    expect(screen.queryByRole('heading', { name: 'No downloads yet' })).toBeNull();
  });
});
