import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OFFLINE_PLAYING_TEXT, OFFLINE_STALLED_TEXT, OfflineBanner, offlineText } from './OfflineBanner';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { noneAdapter, type CacheAdapter } from '@/lib/autoCache/adapter';

const server = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/lib/playback/serverReach', () => ({ checkServerNow: server.check }));
const sonner = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('sonner', () => ({ toast: sonner.toast }));

const androidAdapter = { ...noneAdapter, kind: 'android-native', nativeState: () => ({}) } as unknown as CacheAdapter;

beforeEach(() => {
  useAutoCacheStore.setState({ online: true, offlineStalled: false, adapter: noneAdapter });
  server.check.mockReset();
  sonner.toast.mockReset();
});

const tryAgain = () => screen.getByRole('button', { name: 'Try again' });

describe('OfflineBanner', () => {
  it('says nothing online', () => {
    expect(offlineText(true, false)).toBeNull();
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('offline, says so at the left with Try again at the right, and goes when back online', () => {
    render(<OfflineBanner />);
    act(() => useAutoCacheStore.setState({ online: false }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^You are offline$/);
    expect(status).toHaveAttribute('aria-label', OFFLINE_PLAYING_TEXT);
    expect(status).toHaveAttribute('data-stalled', 'false');
    const banner = screen.getByTestId('offline-banner');
    expect(banner.firstElementChild).toBe(status);
    expect(banner.lastElementChild).toBe(tryAgain());
    act(() => useAutoCacheStore.setState({ online: true }));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('keeps the stalled state: said out loud and marked', () => {
    useAutoCacheStore.setState({ online: false, offlineStalled: true });
    render(<OfflineBanner />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', OFFLINE_STALLED_TEXT);
    expect(status).toHaveAttribute('data-stalled', 'true');
    expect(status).toHaveTextContent('You are offline, nothing cached ahead');
  });

  it('has one fixed height, whatever it says', () => {
    useAutoCacheStore.setState({ online: false });
    render(<OfflineBanner />);
    expect(screen.getByTestId('offline-banner')).toHaveClass('h-8', 'shrink-0');
  });

  it('Try again checks once at a time and says when still offline, resuming nothing', async () => {
    useAutoCacheStore.setState({ online: false, offlineStalled: true });
    let answer!: (ok: boolean) => void;
    server.check.mockReturnValue(new Promise((r) => { answer = r; }));
    const resume = vi.fn();
    render(<OfflineBanner onResumeStalled={resume} />);
    fireEvent.click(tryAgain());
    expect(tryAgain()).toBeDisabled();
    fireEvent.click(tryAgain());
    expect(server.check).toHaveBeenCalledTimes(1);
    await act(async () => answer(false));
    expect(tryAgain()).toBeEnabled();
    expect(sonner.toast).toHaveBeenCalledWith('Still offline', expect.anything());
    expect(resume).not.toHaveBeenCalled();
  });

  it('back online on the web leaves the song alone: the player handles it', async () => {
    useAutoCacheStore.setState({ online: false, offlineStalled: true });
    server.check.mockImplementation(async () => {
      useAutoCacheStore.setState({ online: true, offlineStalled: false });
      return true;
    });
    const resume = vi.fn();
    render(<OfflineBanner onResumeStalled={resume} />);
    await act(async () => fireEvent.click(tryAgain()));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(resume).not.toHaveBeenCalled();
    expect(sonner.toast).not.toHaveBeenCalled();
  });

  it('back online on Android asks the native player for its stalled song, and only a stalled one', async () => {
    const resume = vi.fn();
    server.check.mockImplementation(async () => {
      useAutoCacheStore.setState({ online: true, offlineStalled: false });
      return true;
    });
    useAutoCacheStore.setState({ online: false, offlineStalled: false, adapter: androidAdapter });
    const { unmount } = render(<OfflineBanner onResumeStalled={resume} />);
    await act(async () => fireEvent.click(tryAgain()));
    expect(resume).not.toHaveBeenCalled();
    unmount();

    useAutoCacheStore.setState({ online: false, offlineStalled: true, adapter: androidAdapter });
    render(<OfflineBanner onResumeStalled={resume} />);
    await act(async () => fireEvent.click(tryAgain()));
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
