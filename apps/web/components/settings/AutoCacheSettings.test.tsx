import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTO_CACHE_UNAVAILABLE_TEXT, AutoCacheSettings } from './AutoCacheSettings';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { noneAdapter, type CacheAdapter } from '@/lib/autoCache/adapter';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const clear = vi.fn(async () => {});
const adapter: CacheAdapter = {
  ...noneAdapter,
  kind: 'opfs',
  clear,
  stats: () => ({ bytes: 34 * 1024 * 1024, count: 9, cap: 250 * 1024 * 1024 }),
};

beforeEach(() => {
  clear.mockClear();
  useSettingsStore.setState({ autoCacheEnabled: true, autoCacheOnMetered: false });
  useAutoCacheStore.setState({ adapter, supported: true, stats: adapter.stats(), cancelInFlight: null });
});

describe('AutoCacheSettings', () => {
  it('shows both switches with their defaults and the storage line', () => {
    render(<AutoCacheSettings />);
    expect(screen.getByRole('button', { name: 'Turn off Cache upcoming songs' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Turn on Also on mobile data' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('auto-cache-stats')).toHaveTextContent('Cached: 34.0 MB, 9 songs');
  });

  it('the switches flip the device settings', () => {
    render(<AutoCacheSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Also on mobile data' }));
    expect(useSettingsStore.getState().autoCacheOnMetered).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Cache upcoming songs' }));
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(false);
    // Mobile data means nothing with caching off.
    expect(screen.getByRole('button', { name: 'Turn off Also on mobile data' })).toBeDisabled();
  });

  it('Clear cached songs stops the download in flight and empties the cache', async () => {
    const cancel = vi.fn();
    useAutoCacheStore.setState({ cancelInFlight: cancel });
    render(<AutoCacheSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear cached songs' }));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalled();
  });

  it('says so where this device cannot cache', () => {
    useAutoCacheStore.setState({ adapter: noneAdapter, supported: false });
    render(<AutoCacheSettings />);
    expect(screen.getByText(AUTO_CACHE_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId('auto-cache-stats')).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn off Cache upcoming songs' })).toBeDisabled();
  });
});
