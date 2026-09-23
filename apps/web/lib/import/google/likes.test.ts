import { describe, expect, it } from 'vitest';
import { isTopic, isoSeconds, likedSongFromVideo, likesFromPage, songName } from '@/lib/import/google/likes';
import { music } from '@/test-utils/fakeGoogle';

// Google keeps one list of likes for YouTube and YouTube Music. Every like
// is read; YouTube Music says which are songs during the transfer. Only an
// auto-generated "- Topic" channel is known up front.

describe('isTopic', () => {
  it('an auto-generated Topic channel, whatever its category', () => {
    expect(isTopic(music('aaaaaaaaaaa', 'Song', 'Nadia Okonkwo - Topic', '24'))).toBe(true);
  });

  it('nothing else, not even category 10', () => {
    expect(isTopic(music('aaaaaaaaaaa', 'Song', 'Band', '10'))).toBe(false);
    expect(isTopic({ id: 'aaaaaaaaaaa' })).toBe(false);
    // "Topic" as a word in a name is not the auto-generated suffix.
    expect(isTopic(music('aaaaaaaaaaa', 'Talk', 'Topic Talks', '22'))).toBe(false);
  });
});

describe('songName', () => {
  it('a Topic channel: the title is the song, the channel minus " - Topic" the artist', () => {
    expect(songName(music('aaaaaaaaaaa', 'Paper Lanterns', 'Halcyon Drift - Topic'))).toEqual({
      title: 'Paper Lanterns',
      artist: 'Halcyon Drift',
    });
  });

  it('a music video: "Artist - Title (Official Video)" becomes the two, without the noise', () => {
    expect(songName(music('aaaaaaaaaaa', 'Halcyon Drift - Paper Lanterns (Official Music Video)', 'HalcyonDriftVEVO'))).toEqual({
      title: 'Paper Lanterns',
      artist: 'Halcyon Drift',
    });
    expect(songName(music('aaaaaaaaaaa', 'Band \u2013 Song [Official Audio]', 'Band'))).toEqual({ title: 'Song', artist: 'Band' });
  });

  it('a title with no artist in it takes the channel, minus VEVO', () => {
    expect(songName(music('aaaaaaaaaaa', 'Slow Weather (Lyrics)', 'NadiaVEVO'))).toEqual({ title: 'Slow Weather', artist: 'Nadia' });
  });
});

describe('isoSeconds', () => {
  it('reads the durations the API gives', () => {
    expect(isoSeconds('PT3M20S')).toBe(200);
    expect(isoSeconds('PT1H2M3S')).toBe(3723);
    expect(isoSeconds('PT45S')).toBe(45);
    expect(isoSeconds('P0D')).toBe(0);
    expect(isoSeconds(undefined)).toBe(0);
    expect(isoSeconds('nonsense')).toBe(0);
  });
});

describe('likedSongFromVideo', () => {
  it('names the real video, ready to play', () => {
    const song = likedSongFromVideo(music('dQw4w9WgXcQ', 'Paper Lanterns', 'Halcyon Drift - Topic'))!;
    expect(song.track).toMatchObject({
      id: 'youtube:dQw4w9WgXcQ',
      sourceId: 'dQw4w9WgXcQ',
      source: 'youtube',
      title: 'Paper Lanterns',
      artist: 'Halcyon Drift',
      durationSec: 200,
      artworkUrl: 'https://i.ytimg.test/dQw4w9WgXcQ/hq.jpg',
      streamUrl: '/api/youtube/stream/dQw4w9WgXcQ',
    });
    expect(song.artists).toEqual(['Halcyon Drift']);
    expect(song.likedAt).toBeNull();
    expect(song.videoType).toBe('ATV');
  });

  it('a video from any other channel waits for YouTube Music to say what it is', () => {
    // Category 10 is the uploader's word, and the owner's Minecraft video had it.
    expect(likedSongFromVideo(music('aaaaaaaaaaa', 'Mob Farm', 'HorseFridge', '10'))!.videoType).toBeNull();
  });

  it('a video id that is not one is no song', () => {
    expect(likedSongFromVideo(music('short', 'Song'))).toBeNull();
    expect(likedSongFromVideo({ snippet: { title: 'x', categoryId: '10' } })).toBeNull();
  });
});

describe('likesFromPage', () => {
  it('keeps every like in order, whatever its category, and lands a double like once', () => {
    const seen = new Set<string>();
    const first = likesFromPage(
      [
        music('aaaaaaaaaaa', 'One'),
        music('bbbbbbbbbbb', 'Gaming', 'Gamer', '20'),
        music('ccccccccccc', 'Two', 'Band - Topic', '24'),
        music('aaaaaaaaaaa', 'One again'),
        music('short', 'Not a video id'),
      ],
      seen,
    );
    expect(first.map((s) => s.track.sourceId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect(first.map((s) => s.videoType)).toEqual([null, null, 'ATV']);
    // Across pages too.
    const second = likesFromPage([music('ccccccccccc', 'Two'), music('ddddddddddd', 'Three')], seen);
    expect(second.map((s) => s.track.sourceId)).toEqual(['ddddddddddd']);
  });
});
