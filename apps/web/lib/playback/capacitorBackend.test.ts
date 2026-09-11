import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createCapacitorBackend } from './capacitorBackend';
import { makeFakeBackend, makeFakeEvents, makeTrack } from '@/test-utils/fakeBackend';

// Swap the real webBackend for the shared fake so no real <audio> element or
// navigator.mediaSession gets touched: this test is only about what
// capacitorBackend hands the native MediaSession plugin.
const webFake = makeFakeBackend();
vi.mock('./webBackend', () => ({
  createWebBackend: () => webFake,
}));

describe('capacitorBackend.setMetadata', () => {
  let setMetadata: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setMetadata = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: {
        MediaSession: {
          setMetadata,
          setPlaybackState: vi.fn().mockResolvedValue(undefined),
          setActionHandler: vi.fn(),
          setPositionState: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.clearAllMocks();
  });

  it('uses the remote artworkUrl when no local art is given', () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ title: 'Track Title', artworkUrl: 'https://example.com/remote.jpg' }));
    expect(setMetadata).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Track Title',
      artwork: [{ src: 'https://example.com/remote.jpg', sizes: '512x512' }],
    }));
  });

  it('prefers local art (the converted _capacitor_file_ src) over the remote artworkUrl', () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(
      makeTrack({ artworkUrl: 'https://example.com/remote.jpg' }),
      'capacitor://localhost/_capacitor_file_/data/art/t1.jpg',
    );
    expect(setMetadata).toHaveBeenCalledWith(expect.objectContaining({
      artwork: [{ src: 'capacitor://localhost/_capacitor_file_/data/art/t1.jpg', sizes: '512x512' }],
    }));
  });

  it('sends no artwork entry when the track has neither local nor remote art', () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ artworkUrl: null }));
    expect(setMetadata).toHaveBeenCalledWith(expect.objectContaining({ artwork: [] }));
  });

  it('a null track releases the session instead of calling setMetadata', () => {
    const setPlaybackState = (window as unknown as {
      Capacitor: { Plugins: { MediaSession: { setPlaybackState: ReturnType<typeof vi.fn> } } };
    }).Capacitor.Plugins.MediaSession.setPlaybackState;
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(null);
    expect(setMetadata).not.toHaveBeenCalled();
    expect(setPlaybackState).toHaveBeenCalledWith({ playbackState: 'none' });
  });
});
