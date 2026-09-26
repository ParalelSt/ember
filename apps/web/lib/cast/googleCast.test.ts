import { describe, expect, it } from 'vitest';
import { buildLoadRequest, googleRemote } from './googleCast';
import { makeFakeCastGlobals } from '@/test-utils/fakeGoogleCast';

const MEDIA = {
  url: 'https://ember.example.ts.net/api/youtube/stream/aaaaaaaaaaa?st=t',
  contentType: 'audio/mp4',
  title: 'Night Drive',
  artist: 'The Nulls',
  album: 'Night Shift',
  artworkUrl: 'https://lh3.googleusercontent.com/cover',
};

describe('Google Cast load request', () => {
  it('is a music track with title, artist, album and cover for the TV, starting where asked', () => {
    const { globals } = makeFakeCastGlobals();
    const req = buildLoadRequest(globals, MEDIA, { startAt: 42.5, autoplay: true }) as {
      autoplay: boolean; currentTime: number;
      media: { contentId: string; contentType: string; streamType: string; metadata: { title: string; artist: string; albumName: string; images: { url: string }[] } };
    };
    expect(req.autoplay).toBe(true);
    expect(req.currentTime).toBe(42.5);
    expect(req.media.contentId).toBe(MEDIA.url);
    expect(req.media.contentType).toBe('audio/mp4');
    expect(req.media.streamType).toBe('BUFFERED');
    expect(req.media.metadata.title).toBe('Night Drive');
    expect(req.media.metadata.artist).toBe('The Nulls');
    expect(req.media.metadata.albumName).toBe('Night Shift');
    expect(req.media.metadata.images.map((i) => i.url)).toEqual([MEDIA.artworkUrl]);
  });

  it('no album and no cover leave those out', () => {
    const { globals } = makeFakeCastGlobals();
    const req = buildLoadRequest(globals, { ...MEDIA, album: null, artworkUrl: null }, { startAt: -3, autoplay: false }) as {
      autoplay: boolean; currentTime: number; media: { metadata: { albumName?: string; images?: unknown[] } };
    };
    expect(req.media.metadata.albumName).toBeUndefined();
    expect(req.media.metadata.images).toBeUndefined();
    expect(req.currentTime).toBe(0);
    expect(req.autoplay).toBe(false);
  });
});

describe('Google Cast remote', () => {
  it('reports the receiver, with the idle reason from the media session', async () => {
    const { globals, session, players, controllers } = makeFakeCastGlobals();
    const remote = googleRemote(globals, session);
    const seen: string[] = [];
    remote.subscribe((s) => seen.push(`${s.state}:${s.idleReason}:${s.time}`));
    players[0].playerState = 'PLAYING';
    players[0].currentTime = 12;
    players[0].duration = 200;
    controllers[0].fire();
    players[0].playerState = 'IDLE';
    session.media = { playerState: 'IDLE', idleReason: 'FINISHED' };
    controllers[0].fire();
    expect(seen).toEqual(['playing:null:12', 'idle:finished:12']);
    expect(remote.status().duration).toBe(200);
  });

  it('play and pause only toggle when needed; seek and volume go through the controller', () => {
    const { globals, session, players, controllers } = makeFakeCastGlobals();
    const remote = googleRemote(globals, session);
    players[0].isPaused = true;
    remote.pause();
    expect(controllers[0].playOrPause).not.toHaveBeenCalled();
    remote.play();
    expect(controllers[0].playOrPause).toHaveBeenCalledTimes(1);
    remote.seek(33);
    expect(players[0].currentTime).toBe(33);
    expect(controllers[0].seek).toHaveBeenCalled();
    remote.setVolume(0.25);
    expect(players[0].volumeLevel).toBe(0.25);
    expect(controllers[0].setVolumeLevel).toHaveBeenCalled();
    players[0].canControlVolume = false;
    remote.setVolume(0.9);
    expect(players[0].volumeLevel).toBe(0.25);
  });

  it('a load the receiver refuses is an error', async () => {
    const { globals, session } = makeFakeCastGlobals();
    session.loadMedia.mockResolvedValueOnce('LOAD_FAILED');
    await expect(googleRemote(globals, session).load(MEDIA, { startAt: 0, autoplay: true })).rejects.toThrow(/LOAD_FAILED/);
  });
});
