import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { OFFLINE_PLAYING_TEXT, OFFLINE_STALLED_TEXT, OfflineBadge, offlineBadgeText } from './OfflineBadge';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';

beforeEach(() => useAutoCacheStore.setState({ online: true, offlineStalled: false }));

describe('OfflineBadge', () => {
  it('says nothing online', () => {
    expect(offlineBadgeText(true, false)).toBeNull();
    render(<OfflineBadge />);
    expect(screen.queryByTestId('offline-badge')).toBeNull();
  });

  it('offline, says cached songs are playing, then that nothing is cached ahead', () => {
    render(<OfflineBadge />);
    act(() => useAutoCacheStore.setState({ online: false }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', OFFLINE_PLAYING_TEXT);
    // The desktop pill is short, so the song keeps its room.
    expect(screen.getByRole('status')).toHaveTextContent(/^Offline$/);
    act(() => useAutoCacheStore.setState({ offlineStalled: true }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', OFFLINE_STALLED_TEXT);
    act(() => useAutoCacheStore.setState({ online: true, offlineStalled: false }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('inline (the phone bar) spells the whole state out', () => {
    useAutoCacheStore.setState({ online: false, offlineStalled: true });
    render(<OfflineBadge inline />);
    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE_STALLED_TEXT);
  });
});
