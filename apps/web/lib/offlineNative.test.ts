import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { localArtFor, localSrcFor, useTrackArtSrc } from './offlineNative';
import { useOfflineStore } from '@/stores/useOfflineStore';
import type { Track } from '@/types/track';

function makeTrack(id: string, artworkUrl: string | null = 'https://example.com/remote.jpg'): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: 'Track',
    artist: 'Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100,
    artworkUrl,
    streamUrl: '',
  };
}

describe('localArtFor / localSrcFor', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('returns null when there is no Capacitor bridge', () => {
    expect(localArtFor(makeTrack('t1'), { t1: '/data/art/t1.jpg' })).toBeNull();
    expect(localSrcFor(makeTrack('t1'), { t1: '/data/audio/t1.m4a' })).toBeNull();
  });

  it('returns null when the track has no local file recorded', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      convertFileSrc: (p: string) => `capfile://${p}`,
    };
    expect(localArtFor(makeTrack('t1'), {})).toBeNull();
  });

  it('converts the absolute path through Capacitor.convertFileSrc', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      convertFileSrc: (p: string) => `capfile://${p}`,
    };
    expect(localArtFor(makeTrack('t1'), { t1: '/data/art/t1.jpg' })).toBe('capfile:///data/art/t1.jpg');
    expect(localSrcFor(makeTrack('t1'), { t1: '/data/audio/t1.m4a' })).toBe('capfile:///data/audio/t1.m4a');
  });
});

describe('useTrackArtSrc', () => {
  beforeEach(() => {
    useOfflineStore.setState({ artFiles: {} });
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('returns null for no track', () => {
    const { result } = renderHook(() => useTrackArtSrc(null));
    expect(result.current).toBeNull();
  });

  it('falls back to the remote artworkUrl when there is no local art', () => {
    const { result } = renderHook(() => useTrackArtSrc(makeTrack('t1', 'https://example.com/remote.jpg')));
    expect(result.current).toBe('https://example.com/remote.jpg');
  });

  it('prefers local art over the remote artworkUrl when a downloaded copy has one', () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      convertFileSrc: (p: string) => `capfile://${p}`,
    };
    useOfflineStore.setState({ artFiles: { t1: '/data/art/t1.jpg' } });
    const { result } = renderHook(() => useTrackArtSrc(makeTrack('t1', 'https://example.com/remote.jpg')));
    expect(result.current).toBe('capfile:///data/art/t1.jpg');
  });

  it('is null when there is neither local art nor a remote artworkUrl', () => {
    const { result } = renderHook(() => useTrackArtSrc(makeTrack('t1', null)));
    expect(result.current).toBeNull();
  });
});
