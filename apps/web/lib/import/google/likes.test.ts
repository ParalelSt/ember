import { describe, expect, it } from 'vitest';
import { isMusic, isoSeconds, isTopic, likedSongFromVideo, musicFromPage, songName } from '@/lib/import/google/likes';
import { music } from '@/test-utils/fakeGoogle';

// Google keeps one list of likes for YouTube and YouTube Music. The first
// pass, which costs nothing: category 10, or an auto-generated "- Topic"
// channel. YouTube Music checks the survivors next (musicCheck.test.ts).

describe('isMusic', () => {
  it('keeps category 10', () => {
    expect(isMusic(music('aaaaaaaaaaa', 'Song', 'Band', '10'))).toBe(true);
  });

  it('keeps a Topic channel whatever its category', () => {
    expect(isMusic(music('aaaaaaaaaaa', 'Song', 'Nadia Okonkwo - Topic', '24'))).toBe(true);
  });

  it('leaves out everything else', () => {
    expect(isMusic(music('aaaaaaaaaaa', 'Speedrun', 'Gamer', '20'))).toBe(false);
    expect(isMusic(music('aaaaaaaaaaa', 'How to bake', 'Kitchen', '26'))).toBe(false);
    expect(isMusic({ id: 'aaaaaaaaaaa' })).toBe(false);
    // "Topic" as a word in a name is not the auto-generated suffix.
    expect(isMusic(music('aaaaaaaaaaa', 'Talk', 'Topic Talks', '22'))).toBe(false);
  });
});

describe('isTopic', () => {
  it('only the auto-generated suffix, not category 10 and not the word', () => {
    expect(isTopic(music('aaaaaaaaaaa', 'Song', 'Nadia Okonkwo - Topic', '24'))).toBe(true);
    expect(isTopic(music('aaaaaaaaaaa', 'Song', 'Band', '10'))).toBe(false);
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
    // A Topic channel is official audio: YouTube Music need not be asked.
    expect(song.videoType).toBe('ATV');
  });

  it('a video from any other channel waits for YouTube Music to say what it is', () => {
    // Category 10 is only the uploader's word, and the owner's Minecraft video had it.
    expect(likedSongFromVideo(music('aaaaaaaaaaa', 'Mob Farm', 'HorseFridge', '10'))!.videoType).toBeNull();
  });

  it('a video id that is not one is no song', () => {
    expect(likedSongFromVideo(music('short', 'Song'))).toBeNull();
    expect(likedSongFromVideo({ snippet: { title: 'x', categoryId: '10' } })).toBeNull();
  });
});

describe('musicFromPage', () => {
  it('keeps music in order, counts what it left out, and lands a double like once', () => {
    const seen = new Set<string>();
    const first = musicFromPage(
      [
        music('aaaaaaaaaaa', 'One'),
        music('bbbbbbbbbbb', 'Gaming', 'Gamer', '20'),
        music('ccccccccccc', 'Two', 'Band - Topic', '24'),
        music('aaaaaaaaaaa', 'One again'),
      ],
      seen,
    );
    expect(first.songs.map((s) => s.track.sourceId)).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
    expect(first.skipped).toBe(1);
    // Across pages too.
    const second = musicFromPage([music('ccccccccccc', 'Two'), music('ddddddddddd', 'Three')], seen);
    expect(second.songs.map((s) => s.track.sourceId)).toEqual(['ddddddddddd']);
  });
});
