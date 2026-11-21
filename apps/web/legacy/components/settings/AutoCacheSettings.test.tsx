import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTO_CACHE_UNAVAILABLE_TEXT, AUTO_CACHE_UPDATE_APP_TEXT, AutoCacheSettings } from './AutoCacheSettings';
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
  useSettingsStore.setState({ autoCacheEnabled: true });
  useAutoCacheStore.setState({ adapter, supported: true, needsAppUpdate: false, stats: adapter.stats(), cancelInFlight: null });
});

describe('AutoCacheSettings', () => {
  it('shows the switch with its default and the storage line', () => {
    render(<AutoCacheSettings />);
    expect(screen.getByRole('button', { name: 'Turn off Cache upcoming songs' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/on Wi-Fi and mobile data/)).toBeInTheDocument();
    // There is no mobile data switch: caching always works on it.
    expect(screen.queryByRole('button', { name: /mobile data/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Turn (on|off) / })).toHaveLength(1);
    expect(screen.getByTestId('auto-cache-stats')).toHaveTextContent('Cached: 34.0 MB, 9 songs');
  });

  it('the switch flips the device setting', () => {
    render(<AutoCacheSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Cache upcoming songs' }));
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Cache upcoming songs' }));
    expect(useSettingsStore.getState().autoCacheEnabled).toBe(true);
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

  it('an app too old for the cache says to update it', () => {
    useAutoCacheStore.setState({ adapter: noneAdapter, supported: false, needsAppUpdate: true });
    render(<AutoCacheSettings />);
    expect(screen.getByText(AUTO_CACHE_UPDATE_APP_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(AUTO_CACHE_UNAVAILABLE_TEXT)).toBeNull();
  });

  it('re-reads the totals of a cache that lives outside the page', async () => {
    let bytes = 1024 * 1024;
    const reload = vi.fn(async () => { bytes = 5 * 1024 * 1024; });
    const native: CacheAdapter = {
      ...noneAdapter,
      kind: 'android-native',
      stats: () => ({ bytes, count: bytes > 1024 * 1024 ? 2 : 1, cap: 300 * 1024 * 1024 }),
      reload,
    };
    useAutoCacheStore.setState({ adapter: native, supported: true, stats: native.stats() });
    render(<AutoCacheSettings />);
    await waitFor(() => expect(screen.getByTestId('auto-cache-stats')).toHaveTextContent('Cached: 5.0 MB, 2 songs'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
