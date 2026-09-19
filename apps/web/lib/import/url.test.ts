import { describe, expect, it } from 'vitest';
import { parseImportUrl } from '@/lib/import/url';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('parseImportUrl: Spotify', () => {
  it.each([
    `https://open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/playlist/${ID}?si=abc123def456`,
    `https://open.spotify.com/intl-de/playlist/${ID}`,
    `https://open.spotify.com/embed/playlist/${ID}`,
    `open.spotify.com/playlist/${ID}`,
    `  https://open.spotify.com/playlist/${ID}/  `,
    `spotify:playlist:${ID}`,
  ])('%s', (link) => {
    expect(parseImportUrl(link)).toEqual({ source: 'spotify', id: ID });
  });

  it('keeps a short link for the server to resolve', () => {
    expect(parseImportUrl('https://spotify.link/AbCdEf123')).toEqual({
      source: 'spotify-short',
      url: 'https://spotify.link/AbCdEf123',
    });
  });

  it.each([
    `https://open.spotify.com/album/${ID}`,
    `https://open.spotify.com/track/${ID}`,
    'https://open.spotify.com/playlist/tooShort',
    `https://open.spotify.com.evil.example/playlist/${ID}`,
    `https://evil.example/open.spotify.com/playlist/${ID}`,
    'spotify:playlist:bad',
    'https://spotify.link/',
    `ftp://open.spotify.com/playlist/${ID}`,
  ])('rejects %s', (link) => {
    expect(parseImportUrl(link)).toBeNull();
  });
});

describe('parseImportUrl: YouTube Music and YouTube', () => {
  const LIST = 'RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs';
  it.each([
    `https://music.youtube.com/playlist?list=${LIST}`,
    `https://www.youtube.com/playlist?list=${LIST}`,
    `https://m.youtube.com/playlist?list=${LIST}`,
    `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${LIST}`,
    `https://youtu.be/dQw4w9WgXcQ?list=${LIST}`,
    `music.youtube.com/playlist?list=${LIST}&si=xyz`,
  ])('%s', (link) => {
    expect(parseImportUrl(link)).toEqual({ source: 'ytmusic', id: LIST });
  });

  it.each([
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/playlist?list=short',
    'https://music.youtube.com/playlist?list=bad%20chars%20here!!',
    'https://notyoutube.com/playlist?list=PL1234567890abcdef',
  ])('rejects %s', (link) => {
    expect(parseImportUrl(link)).toBeNull();
  });
});

describe('parseImportUrl: anything else', () => {
  it.each(['', 'hello', 'https://example.com/playlist/x', 'javascript:alert(1)'])('rejects %j', (link) => {
    expect(parseImportUrl(link)).toBeNull();
  });
});
