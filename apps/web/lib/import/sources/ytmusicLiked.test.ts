import { describe, it, expect } from 'vitest';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import {
  checkPastedHeaders,
  MAX_HEADERS_CHARS,
  normalisePastedHeaders,
  parseYtmusicLiked,
  YTMUSIC_HEADERS_STEPS,
  YTMUSIC_LIKED_LABEL,
  type LikedSong,
} from '@/lib/import/sources/ytmusicLiked';
import type { Track } from '@/types/track';

const SAPISID = 's3cr3tSAPISIDvalue';
const COOKIE = `SAPISID=${SAPISID}; __Secure-3PAPISID=s3cr3t3PAPISID; HSID=s3cr3tHSID`;
const HEADERS = ['accept: */*', `cookie: ${COOKIE}`, 'user-agent: Mozilla/5.0', 'x-goog-authuser: 0'].join('\n');

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

describe('checkPastedHeaders', () => {
  it('accepts a real header block', () => {
    expect(checkPastedHeaders(HEADERS)).toBeNull();
  });

  it('asks for a paste when there is none', () => {
    expect(checkPastedHeaders(undefined)?.error).toContain('Paste your YouTube Music request headers');
    expect(checkPastedHeaders('   ')?.error).toContain('Paste your YouTube Music request headers');
    expect(checkPastedHeaders({ secret: HEADERS })?.error).toBeTruthy();
  });

  it('turns away more text than a header block could be', () => {
    expect(checkPastedHeaders('x'.repeat(MAX_HEADERS_CHARS + 1))?.error).toContain('more text');
  });

  it('says so when there is no Cookie line', () => {
    expect(checkPastedHeaders('accept: */*\nx-goog-authuser: 0')?.error).toContain('no Cookie header');
  });

  it('spots a signed-out tab, where the Cookie line says nothing about who you are', () => {
    const out = checkPastedHeaders('cookie: YSC=abc; VISITOR_INFO1_LIVE=def\nx-goog-authuser: 0');
    expect(out?.error).toContain('signed-out');
  });

  it('says so when x-goog-authuser is missing', () => {
    expect(checkPastedHeaders(`cookie: ${COOKIE}`)?.error).toContain('x-goog-authuser');
  });

  it('never quotes the paste back, whatever is wrong with it', () => {
    const bad = [`cookie: ${COOKIE}`, 'cookie: YSC=abc\nx-goog-authuser: 0', 'x'.repeat(MAX_HEADERS_CHARS + 1), ''];
    for (const input of bad) expect(checkPastedHeaders(input)?.error ?? '').not.toContain('s3cr3t');
  });

  it('accepts what Chrome copies as a fetch call', () => {
    const chrome = `fetch("https://music.youtube.com/youtubei/v1/browse", {
  "headers": {
    "accept": "*/*",
    "cookie": "${COOKIE}",
    "x-goog-authuser": "0"
  },
  "method": "POST"
});`;
    expect(checkPastedHeaders(chrome)).toBeNull();
  });
});

describe('normalisePastedHeaders', () => {
  it('turns a fetch snippet into the lines ytmusicapi reads', () => {
    const chrome = `{\n  "headers": {\n    "cookie": "${COOKIE}",\n    "x-goog-authuser": "0"\n  }\n}`;
    expect(normalisePastedHeaders(chrome)).toBe(`cookie: ${COOKIE}\nx-goog-authuser: 0`);
  });

  it('unescapes what JSON escaped', () => {
    const chrome = '{\n  "cookie": "SAPISID=a\\"b",\n  "x-goog-authuser": "0"\n}';
    expect(normalisePastedHeaders(chrome)).toBe('cookie: SAPISID=a"b\nx-goog-authuser: 0');
  });

  it('leaves an ordinary paste exactly as it is', () => {
    expect(normalisePastedHeaders(`  ${HEADERS}  `)).toBe(HEADERS);
  });

  it('leaves a quoted line alone when there is no cookie among them', () => {
    const text = '"accept": "*/*"\n"user-agent": "Mozilla/5.0"';
    expect(normalisePastedHeaders(text)).toBe(text);
  });
});

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

describe('the steps the dialog renders', () => {
  it('say where to do it, what to click and what Ember does with it', () => {
    const all = YTMUSIC_HEADERS_STEPS.join(' ');
    expect(all).toContain('music.youtube.com');
    expect(all).toContain('Network');
    expect(all).toContain('browse');
    expect(all).toContain('never stores it');
  });

  it('have no em dashes', () => {
    expect(YTMUSIC_HEADERS_STEPS.join(' ')).not.toContain('—');
  });
});
