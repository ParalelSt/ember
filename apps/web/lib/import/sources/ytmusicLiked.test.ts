import { describe, it, expect } from 'vitest';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import {
  GOOGLE_FORGET_NOTE,
  GOOGLE_MESSAGES,
  GOOGLE_SIGNIN_STEPS,
  noMusicMessage,
  parseYtmusicLiked,
  skippedLine,
  YTMUSIC_LIKED_LABEL,
  type LikedSong,
} from '@/lib/import/sources/ytmusicLiked';
import type { Track } from '@/types/track';

function song(videoId: string, title: string, artists = ['Artist One', 'Artist Two']): LikedSong {
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
  return { track, artists, likedAt: null };
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

  it('says how many likes were not music, in the singular too', () => {
    expect(skippedLine(1)).toBe('Left out 1 like that is not music.');
    expect(skippedLine(12)).toBe('Left out 12 likes that are not music.');
    expect(noMusicMessage(0)).toBe(GOOGLE_MESSAGES.noLikes);
    expect(noMusicMessage(3)).toContain('None of the 3 videos');
  });

  it('have no em dashes', () => {
    const all = [...GOOGLE_SIGNIN_STEPS, GOOGLE_FORGET_NOTE, ...Object.values(GOOGLE_MESSAGES), skippedLine(2), noMusicMessage(2)];
    for (const line of all) expect(line).not.toContain('\u2014');
  });
});
