import { describe, it, expect } from 'vitest';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import {
  GOOGLE_FORGET_NOTE,
  GOOGLE_MESSAGES,
  GOOGLE_MUSIC_ONLY_NOTE,
  GOOGLE_SIGNIN_STEPS,
  checkingLine,
  noMusicMessage,
  noSongsMessage,
  parseYtmusicLiked,
  toCheckLine,
  YTMUSIC_LIKED_LABEL,
  type LikedSong,
} from '@/lib/import/sources/ytmusicLiked';
import type { MusicVideoType } from '@/lib/import/musicCheck';
import { UPLOAD_REASON } from '@/lib/import/musicCheck';
import type { Track } from '@/types/track';

/** A like YouTube Music has already answered for: a song unless told. */
function song(videoId: string, title: string, artists = ['Artist One', 'Artist Two'], videoType: MusicVideoType | null = 'ATV'): LikedSong {
  const track: Track = {
    id: `youtube:${videoId}`,
    sourceId: videoId,
    source: 'youtube',
    title,
    artist: artists[0] ?? 'Unknown',
    artistId: null,
    album: 'An Album',
    albumId: null,
    durationSec: 202,
    artworkUrl: 'https://lh3.example/large',
    streamUrl: `/api/youtube/stream/${videoId}`,
  };
  return { track, artists, likedAt: null, videoType };
}

describe('parseYtmusicLiked', () => {
  it('names itself and keeps the order the likes came in', () => {
    const parsed = parseYtmusicLiked([song('aaaaaaaaaaa', 'First'), song('bbbbbbbbbbb', 'Second')]);
    expect(parsed.kind).toBe('ytmusic-liked');
    expect(parsed.label).toBe(YTMUSIC_LIKED_LABEL);
    expect(parsed.order).toBe('newest-first');
    expect(parsed.items.map((i) => i.position)).toEqual([0, 1]);
    expect(parsed.items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(parsed.truncated).toBe(false);
  });

  it('gives every item its candidate, so nothing is searched for', () => {
    const [item] = parseYtmusicLiked([song('aaaaaaaaaaa', 'First')]).items;
    expect(item.candidates).toHaveLength(1);
    expect(item.candidates?.[0].track.sourceId).toBe('aaaaaaaaaaa');
    expect(item.candidates?.[0].score).toBe(100);
    expect(item.candidates?.[0].reasons).toEqual(['From your YouTube Music likes']);
  });

  it('songs come first and are left for the runner, an upload waits for a look, and a like that is not music is only counted', () => {
    const parsed = parseYtmusicLiked([
      song('aaaaaaaaaaa', 'Mob Farm', ['HorseFridge'], null),
      song('bbbbbbbbbbb', 'Official audio', ['Band'], 'ATV'),
      song('ccccccccccc', 'Garage demo', ['Band'], 'UGC'),
      song('ddddddddddd', 'Official video', ['Band'], 'OMV'),
    ]);
    expect(parsed.items.map((i) => [i.position, i.title, i.status ?? 'pending'])).toEqual([
      [0, 'Official audio', 'pending'],
      [1, 'Garage demo', 'review'],
      [2, 'Official video', 'pending'],
      [3, 'Mob Farm', 'skipped'],
    ]);
    expect(parsed.items.map((i) => i.candidates?.[0].videoType)).toEqual(['ATV', 'UGC', 'OMV', null]);
    // The review sheet says why it asks about the upload.
    expect(parsed.items[1].candidates?.[0].reasons).toEqual(['From your YouTube Music likes', UPLOAD_REASON]);
  });

  it('a like nobody said anything about is not music', () => {
    const unsaid = { ...song('aaaaaaaaaaa', 'First'), videoType: undefined };
    expect(parseYtmusicLiked([unsaid]).items[0].status).toBe('skipped');
  });

  it('keeps every artist YouTube Music named, not only the first', () => {
    const [item] = parseYtmusicLiked([song('aaaaaaaaaaa', 'First', ['Bjork', 'Guest'])]).items;
    expect(item.artists).toEqual(['Bjork', 'Guest']);
    expect(item.artist).toBe('Bjork, Guest');
  });

  it('carries a like date through when a source has one', () => {
    const dated = { ...song('aaaaaaaaaaa', 'First'), likedAt: 1_700_000_000_000 };
    expect(parseYtmusicLiked([dated]).items[0].likedAt).toBe(1_700_000_000_000);
    // YouTube Music itself gives none, and the order is what dates them then.
    expect(parseYtmusicLiked([song('bbbbbbbbbbb', 'Second')]).items[0].likedAt).toBeNull();
  });

  it('reports what the reader dropped and what it could not carry', () => {
    const parsed = parseYtmusicLiked([song('aaaaaaaaaaa', 'First')], { truncated: true, dropped: 3 });
    expect(parsed.dropped).toBe(3);
    expect(parsed.truncated).toBe(true);
  });

  it('cuts a library bigger than one transfer may carry', () => {
    const many = Array.from({ length: MAX_TRANSFER_ITEMS + 5 }, (_, i) => song(`vid${String(i).padStart(8, '0')}`, `Song ${i}`));
    const parsed = parseYtmusicLiked(many);
    expect(parsed.items).toHaveLength(MAX_TRANSFER_ITEMS);
    expect(parsed.truncated).toBe(true);
  });

  it('an empty library parses to an empty list', () => {
    expect(parseYtmusicLiked([]).items).toEqual([]);
  });
});

describe('the words the sign-in says', () => {
  it('the steps name the button, the page and the yes', () => {
    const all = GOOGLE_SIGNIN_STEPS.join(' ');
    expect(all).toContain('Sign in with Google');
    expect(all).toContain('google.com/device');
    expect(all).toMatch(/Say yes/);
    expect(GOOGLE_FORGET_NOTE).toMatch(/signs itself out/);
  });

  it('every ending is one plain sentence, including the three the owner asked for', () => {
    expect(GOOGLE_MESSAGES.denied).toBe("You said no on Google's page, so nothing was read.");
    expect(GOOGLE_MESSAGES.expired).toBe('The code ran out. Press Sign in with Google to get a new one.');
    expect(GOOGLE_MESSAGES.notConfigured).toBe('This server is not set up for Google sign-in yet.');
    for (const m of Object.values(GOOGLE_MESSAGES)) {
      expect(m).toMatch(/^[A-Z].*\.$/);
      expect(m).not.toMatch(/token|oauth|http|error/i);
    }
  });

  it('says how far the check is, and how many uploads need a look, in the singular too', () => {
    expect(checkingLine(40, 120)).toBe('Checking which likes are songs: 40 of 120');
    expect(toCheckLine(5)).toBe('5 more need a quick check: uploads YouTube Music is not sure are songs.');
    expect(toCheckLine(1)).toBe('1 more needs a quick check: an upload YouTube Music is not sure is a song.');
    expect(GOOGLE_MUSIC_ONLY_NOTE).toMatch(/YouTube Music says which of your likes are songs/);
  });

  it('an account with nothing to bring over says why', () => {
    expect(noMusicMessage(0)).toBe(GOOGLE_MESSAGES.noLikes);
    expect(noMusicMessage(3)).toContain('None of the 3 videos');
    expect(noSongsMessage(2)).toBe('YouTube Music says none of the 2 likes on that Google account are songs, so there is nothing to bring over.');
    expect(noSongsMessage(1)).toContain('the 1 like on that Google account is a song');
  });

  it('have no em dashes', () => {
    const all = [...GOOGLE_SIGNIN_STEPS, GOOGLE_FORGET_NOTE, ...Object.values(GOOGLE_MESSAGES), GOOGLE_MUSIC_ONLY_NOTE, checkingLine(1, 2), toCheckLine(2), noMusicMessage(2), noSongsMessage(2)];
    for (const line of all) expect(line).not.toContain('\u2014');
  });
});
