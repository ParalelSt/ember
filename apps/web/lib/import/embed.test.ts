import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmbedError, parseEmbedPage, SPOTIFY_EMBED_LIMIT, splitArtists } from '@/lib/import/embed';

// Saved from open.spotify.com/embed/playlist/<id> (2026-09-19) and stripped
// to the __NEXT_DATA__ fields the parser reads. No test fetches Spotify.
const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'imports', name), 'utf8');

describe('parseEmbedPage', () => {
  const pl = parseEmbedPage(fixture('spotify-embed-todays-top-hits.html'));

  it('reads the playlist name, id and cover', () => {
    expect(pl.name).toBe('Today’s Top Hits');
    expect(pl.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(pl.coverUrl).toMatch(/^https:\/\/i\.scdn\.co\/image\//);
  });

  it('reads every track with title, artists, length, explicit flag and uri', () => {
    expect(pl.items).toHaveLength(50);
    expect(pl.items[0]).toEqual({
      position: 0,
      title: 'Bass Persuades',
      artists: ['Miley Cyrus'],
      artist: 'Miley Cyrus',
      durationMs: 202460,
      explicit: false,
      uri: 'spotify:track:2FZcjBYK4dTt48q94pJbJD',
    });
    expect(pl.items.map((i) => i.position)).toEqual([...Array(50).keys()]);
    expect(pl.items.every((i) => i.title && i.artist && i.durationMs && typeof i.explicit === 'boolean')).toBe(true);
    expect(pl.items.some((i) => i.explicit)).toBe(true);
  });

  it('does not flag a 50-track playlist as cut off', () => {
    expect(pl.mayBeTruncated).toBe(false);
  });

  it('flags a playlist that fills the 100-track cap', () => {
    const big = parseEmbedPage(fixture('spotify-embed-all-out-80s.html'));
    expect(big.name).toBe('All Out 80s');
    expect(big.items).toHaveLength(SPOTIFY_EMBED_LIMIT);
    expect(big.mayBeTruncated).toBe(true);
    const ewf = big.items.find((i) => i.artist === 'Earth, Wind & Fire');
    expect(ewf?.artists).toEqual(['Earth, Wind & Fire']);
    const multi = big.items.find((i) => i.artist === 'Eurythmics, Annie Lennox, Dave Stewart');
    expect(multi?.artists).toEqual(['Eurythmics', 'Annie Lennox', 'Dave Stewart']);
  });

  it('says not-found for Spotify\'s "Page not found" state', () => {
    expect(() => parseEmbedPage(fixture('spotify-embed-not-found.html'))).toThrow(
      expect.objectContaining({ kind: 'not-found' }),
    );
  });

  it('says unreadable when the page shape changed', () => {
    const cases = [
      '<html><body>no data</body></html>',
      '<script id="__NEXT_DATA__" type="application/json">{not json</script>',
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>',
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"type":"playlist","name":"x"}}}}}}</script>',
    ];
    for (const html of cases) {
      let caught: unknown;
      try {
        parseEmbedPage(html);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(EmbedError);
      expect((caught as EmbedError).kind).toBe('unreadable');
    }
  });

  it('skips episodes and local files but keeps source positions', () => {
    const data = {
      props: {
        pageProps: {
          state: {
            data: {
              entity: {
                type: 'playlist',
                id: 'x',
                name: 'Mixed',
                trackList: [
                  { uri: 'spotify:episode:1', title: 'A podcast', subtitle: 'Show', duration: 1000, entityType: 'episode' },
                  { uri: 'spotify:local:::a:1', title: 'Local', subtitle: 'Me', duration: 1000 },
                  { uri: 'spotify:track:1', title: 'Real', subtitle: 'Band', duration: 1000, isExplicit: true, entityType: 'track' },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    const parsed = parseEmbedPage(html);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ position: 2, title: 'Real', explicit: true });
  });
});

describe('splitArtists', () => {
  it('splits on comma + no-break space only, so band names with a comma stay whole', () => {
    expect(splitArtists('A,\u00a0B,\u00a0C')).toEqual(['A', 'B', 'C']);
    expect(splitArtists('Tyler, The Creator')).toEqual(['Tyler, The Creator']);
    expect(splitArtists('Tyler, The Creator,\u00a0Kali Uchis')).toEqual(['Tyler, The Creator', 'Kali Uchis']);
    expect(splitArtists('')).toEqual([]);
  });
});
