import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/components/OnlineOnly', () => ({ OnlineOnly: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/track/ShareButton', () => ({ ShareButton: () => null }));
vi.mock('@/components/track/menus/AddToPlaylistMenu', () => ({ AddToPlaylistMenu: () => null }));
vi.mock('@/components/primitives/PlayButton', () => ({ PlayButton: () => null }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ playTrack: vi.fn() }) }));

let data: Record<string, unknown>;
vi.mock('@/hooks/useLibrary', () => ({
  useQueryTrack: () => ({ data, isLoading: false, error: null }),
}));

import { TrackPageClient } from './TrackPageClient';

const base = { id: 'youtube:Sn1HdLrl94A', title: 'Mangio Pasta', artist: 'Peki', album: null, durationSec: 120, artworkUrl: null };

describe('TrackPageClient artist link', () => {
  it('links the artist when the route resolved an id (fallback case)', () => {
    data = { ...base, artistId: 'UCresolved' };
    render(<TrackPageClient videoId="Sn1HdLrl94A" />);
    expect(screen.getByRole('link', { name: 'Peki' }).getAttribute('href')).toBe('/artist/UCresolved');
  });
});
