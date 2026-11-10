import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CarPlayerBar } from './CarPlayerBar';
import { stationTrack } from '@/lib/radio/station';

vi.mock('@/lib/offlineNative', () => ({ useTrackArtSrc: () => null }));
vi.mock('@/components/player/OfflineBadge', () => ({ OfflineBadge: () => null }));
vi.mock('@/components/player/UnplayableMessage', () => ({ UnplayableMessage: () => null, useUnplayableMessage: () => null }));

const noop = () => {};

describe('CarPlayerBar', () => {
  it('shows a station like a song: its name and place, with no LIVE tag', () => {
    const track = stationTrack({ id: '00000000-0000-4000-8000-000000000001', name: 'Antena Zagreb', favicon: null, state: 'Grad Zagreb', country: 'Croatia' });
    render(<CarPlayerBar track={track} playing onToggle={noop} onNext={noop} onPrev={noop} onRetry={noop} onOpenQueue={noop} />);
    expect(screen.getByText('Antena Zagreb')).toBeInTheDocument();
    expect(screen.getByText('Grad Zagreb, Croatia')).toBeInTheDocument();
    expect(screen.queryByText(/^live$/i)).toBeNull();
    expect(screen.queryByTestId('live-badge')).toBeNull();
  });
});
