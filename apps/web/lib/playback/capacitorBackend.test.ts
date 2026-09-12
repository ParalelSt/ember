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
    // Local art is re-read through fetch before it goes to the plugin; 'foo'
    // base64-encodes to Zm9v, which keeps the expected data: URL readable.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: async () => new Blob(['foo'], { type: 'image/jpeg' }),
    }));
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
    vi.unstubAllGlobals();
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

  // The plugin fetches artwork with a native HttpURLConnection, which cannot
  // resolve a _capacitor_file_ URL: on the emulator that left the lock screen
  // with no bitmap at all. The follow-up call carries the bytes inline.
  it('follows local art up with a data: URL the native plugin can decode', async () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ title: 'Local Art' }), 'capacitor://localhost/_capacitor_file_/data/art/t1.jpg');
    await vi.waitFor(() => expect(setMetadata).toHaveBeenCalledTimes(2));
    expect(setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Local Art',
      artwork: [{ src: 'data:image/jpeg;base64,Zm9v', sizes: '512x512' }],
    }));
  });

  it('does not re-read a remote artworkUrl, which the plugin can already fetch', async () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ artworkUrl: 'https://example.com/remote.jpg' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(setMetadata).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Two fast skips must not leave the lock screen showing the first track's
  // cover because its read finished last.
  it('drops a local-art read that a later track has already superseded', async () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ title: 'First' }), 'capacitor://localhost/_capacitor_file_/data/art/first.jpg');
    backend.setMetadata(makeTrack({ title: 'Second' }), 'capacitor://localhost/_capacitor_file_/data/art/second.jpg');
    await vi.waitFor(() => expect(setMetadata).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(setMetadata).toHaveBeenCalledTimes(3);
    expect(setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second' }));
  });

  // Skipping to a track with no local art must still cancel the previous
  // track's pending read, or its cover and title come back on the lock screen.
  it('drops a local-art read when the next track has no art at all', async () => {
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ title: 'First' }), 'capacitor://localhost/_capacitor_file_/data/art/first.jpg');
    backend.setMetadata(makeTrack({ title: 'Second', artworkUrl: null }), null);
    await new Promise((r) => setTimeout(r, 20));
    expect(setMetadata).toHaveBeenCalledTimes(2);
    expect(setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second' }));
  });

  it('leaves the first setMetadata alone when the local art cannot be read', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('gone'));
    const backend = createCapacitorBackend(makeFakeEvents());
    backend.setMetadata(makeTrack({ title: 'Broken' }), 'capacitor://localhost/_capacitor_file_/data/art/x.jpg');
    await new Promise((r) => setTimeout(r, 10));
    expect(setMetadata).toHaveBeenCalledTimes(1);
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
