// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import {
  chooseUg,
  decodeEntities,
  isTabUrl,
  parseUgSearch,
  parseUgTabPage,
  rankUg,
  readJsStore,
  sameSong,
  stripUgMarks,
  toResult,
  ugQuery,
  ugSearchUrl,
  ugTabToAlphaTex,
  ugTuningToScientific,
  type UgResult,
} from './ug';

/** tests/fixtures/ug: Ultimate Guitar's page shape, invented content
 *  (tests/fixtures/ug/build.mjs). */
const FIXTURES = path.resolve(__dirname, '../../../../tests/fixtures/ug');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const SONG = { title: 'Harbour Lights', artist: 'The Lantern Keepers' };

interface TabPageData {
  tab: Record<string, unknown>;
  tab_view: { wiki_tab: { content: string } };
}

/** Re-wrap a tab page with its data changed, escaped the way UG does. */
function rewrap(html: string, change: (data: TabPageData) => void): string {
  const store = readJsStore(html) as { store: { page: { data: TabPageData } } };
  change(store.store.page.data);
  const attr = JSON.stringify(store).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html.replace(/data-content="[^"]*"/, `data-content="${attr}"`);
}

const r = (over: Partial<UgResult>): UgResult => ({
  id: 1,
  part: 'guitar',
  songName: 'Harbour Lights',
  artistName: 'The Lantern Keepers',
  section: '',
  version: 1,
  rating: 4.5,
  votes: 100,
  url: 'https://tabs.ultimate-guitar.com/tab/x/y-tabs-1',
  ...over,
});

describe('reading the page', () => {
  it('decodes the entities UG writes, named and numeric', () => {
    expect(decodeEntities('&quot;a&quot; &amp; b &#039;c&#039; &lt;d&gt; caf&eacute; &Ntilde; &#x41; &rsquo; &nope;')).toBe(
      `"a" & b 'c' <d> caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0xd1)} A ${String.fromCharCode(0x2019)} &nope;`,
    );
  });

  it('reads the js-store JSON, and null for a page without it', () => {
    expect(readJsStore(fixture('search.html'))).toHaveProperty('store.page.data.results');
    expect(readJsStore('<html><body>Access denied</body></html>')).toBeNull();
    expect(readJsStore('<div class="js-store" data-content="{not json"></div>')).toBeNull();
  });
});

describe('search results', () => {
  const results = parseUgSearch(fixture('search.html'))!;

  it('keeps free text tabs and bass tabs only', () => {
    const ids = results.map((x) => x.id).sort();
    // Skipped: the marketing row, Pro (9100021), Official (9100031),
    // Chords (9100041), and the premium access type (9100005).
    expect(ids).toEqual([9100001, 9100002, 9100003, 9100004, 9100011, 9100012, 9100051, 9100061]);
    expect(results.find((x) => x.id === 9100011)?.part).toBe('bass');
    expect(results.find((x) => x.id === 9100002)?.section).toBe('intro');
  });

  it('is null for a page that is not a search page (never "nothing found")', () => {
    expect(parseUgSearch('<html>captcha</html>')).toBeNull();
    expect(parseUgSearch(fixture('search-empty.html'))).toEqual([]);
  });

  it('refuses links off UG or to the app', () => {
    expect(isTabUrl('https://tabs.ultimate-guitar.com/tab/a/b-tabs-1')).toBe(true);
    expect(isTabUrl('https://www.ultimate-guitar.com/pro/?tab_id=1')).toBe(false);
    expect(isTabUrl('https://evil.example/tab/a/b-tabs-1')).toBe(false);
    expect(isTabUrl('http://tabs.ultimate-guitar.com/tab/a/b-tabs-1')).toBe(false);
    expect(toResult({ id: 5, type: 'Tabs', tab_access_type: 'public', tab_url: 'https://evil.example/tab/x' })).toBeNull();
  });

  it('chooses the whole-song tab with the most votes among the well rated', () => {
    const picks = chooseUg(results, SONG);
    // 9100002 has more votes but is an intro; 9100003 is rated 5 by two
    // people; 9100004 has 900 votes at 3.6; 9100051 is another band's song
    // and 9100061 another song.
    expect(picks.guitar.map((x) => x.id)).toEqual([9100001, 9100002, 9100004, 9100003]);
    // The bass tab with 140 votes beats a 4.95 with three.
    expect(picks.bass.map((x) => x.id)).toEqual([9100011, 9100012]);
  });

  it('ranks: rating 4+ with enough votes first, then votes', () => {
    const ranked = rankUg([
      r({ id: 1, rating: 5, votes: 1 }),
      r({ id: 2, rating: 4.7, votes: 800 }),
      r({ id: 3, rating: 3.2, votes: 2000 }),
      r({ id: 4, rating: 4.6, votes: 50 }),
      r({ id: 5, rating: 4.9, votes: 3000, section: 'solo' }),
    ]);
    expect(ranked.map((x) => x.id)).toEqual([2, 4, 5, 3, 1]);
  });

  it('matches the song: same title words, the artist when known', () => {
    expect(sameSong(r({}), 'Harbour Lights (Remastered 2011)', 'The Lantern Keepers')).toBe(true);
    expect(sameSong(r({}), 'Harbour Lights', 'Lantern Keepers - Topic')).toBe(true);
    expect(sameSong(r({}), 'Harbour Lights', '')).toBe(true);
    expect(sameSong(r({}), 'Harbour Lights', 'Unknown artist')).toBe(true);
    expect(sameSong(r({ artistName: 'Quiet Engine' }), 'Harbour Lights', 'The Lantern Keepers')).toBe(false);
    expect(sameSong(r({ songName: 'Harbour Lights Reprise' }), 'Harbour Lights', 'The Lantern Keepers')).toBe(false);
    expect(sameSong(r({ songName: 'Harbour Lights (acoustic)' }), 'Harbour Lights', 'The Lantern Keepers')).toBe(true);
  });

  it('searches "artist title" without version noise, tabs and bass tabs in one request', () => {
    expect(ugQuery('Harbour Lights (Remastered 2011) [Official Video]', 'The Lantern Keepers - Topic')).toBe(
      'The Lantern Keepers Harbour Lights',
    );
    expect(ugQuery('Harbour Lights - Live at the Pier', 'Unknown artist')).toBe('Harbour Lights');
    expect(ugQuery('Harbour Lights feat. Someone', 'X')).toBe('X Harbour Lights');
    expect(ugSearchUrl('https://www.ultimate-guitar.com/', 'a b&c')).toBe(
      'https://www.ultimate-guitar.com/search.php?search_type=title&value=a%20b%26c&type%5B%5D=200&type%5B%5D=400',
    );
  });
});

describe('a tab page', () => {
  it('reads the text, the tuning and the tab fields', () => {
    const page = parseUgTabPage(fixture('tab-9100001.html'))!;
    expect(page).toMatchObject({ id: 9100001, part: 'guitar', rating: 4.71, votes: 512, version: 1, section: '' });
    expect(page.tuning).toEqual({ name: 'Drop D', value: 'D A D G B E' });
    expect(page.text).not.toMatch(/\[\/?tab\]|\[\/?ch\]|\r/);
    expect(page.text).toContain('D5       F5         G5');
    expect(page.text).toContain(`caf${String.fromCharCode(0xe9)}`);
  });

  it('strips the marks, keeps chord names', () => {
    expect(stripUgMarks('[tab]e|-0-|\r\n[/tab][ch]Am[/ch] and [ch]G[/ch]\r\nx')).toBe('e|-0-|\nAm and G\nx');
  });

  it('is null for a page that is not a free text tab', () => {
    expect(parseUgTabPage('<html></html>')).toBeNull();
    const pro = rewrap(fixture('tab-9100001.html'), (d) => {
      d.tab.type = 'Pro';
    });
    expect(parseUgTabPage(pro)).toBeNull();
    const paid = rewrap(fixture('tab-9100001.html'), (d) => {
      d.tab.tab_access_type = 'premium';
    });
    expect(parseUgTabPage(paid)).toBeNull();
  });

  it('turns into alphaTex through the text tab parser, tempo and tuning from the tab', () => {
    const page = parseUgTabPage(fixture('tab-9100001.html'))!;
    const res = ugTabToAlphaTex(page, SONG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report).toMatchObject({ strings: 6, tuningName: 'Drop D', bars: 40, tempo: 100, tempoSource: 'text' });
    expect(res.alphaTex).toContain('\\title "Harbour Lights"');
    // AlphaTab reads it back: 40 bars.
    const settings = new alphaTab.Settings();
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(res.alphaTex, settings);
    const score = imp.readScore();
    expect(score.masterBars.length).toBe(40);
    expect(score.tempo).toBe(100);
  });

  it('reads the bass tab as a 4-string bass', () => {
    const res = ugTabToAlphaTex(parseUgTabPage(fixture('tab-9100011.html'))!, SONG);
    expect(res.ok && res.report.instrument).toBe('bass');
    expect(res.ok && res.report.strings).toBe(4);
  });

  it('refuses a page with no notes', () => {
    const res = ugTabToAlphaTex(parseUgTabPage(fixture('tab-9100003.html'))!, SONG);
    expect(res.ok).toBe(false);
  });

  it('uses UG’s tuning when the text names no strings', () => {
    const html = rewrap(fixture('tab-9100001.html'), (d) => {
      const w = d.tab_view.wiki_tab;
      // No labels: "e|" "B|" ... become "|" lines.
      w.content = w.content.replace(/^(\[tab\])?[eBGDAD]\|/gm, '$1|').replace(/Tuning: Drop D\r\n/, '');
    });
    const res = ugTabToAlphaTex(parseUgTabPage(html)!, SONG);
    expect(res.ok && res.report.tuningName).toBe('Drop D');
  });
});

describe('UG tuning to the parser’s override', () => {
  it('places each note in the octave of the standard string, high string first', () => {
    expect(ugTuningToScientific('E A D G B E', 6)).toBe('E4 B3 G3 D3 A2 E2');
    expect(ugTuningToScientific('D A D G B E', 6)).toBe('E4 B3 G3 D3 A2 D2');
    expect(ugTuningToScientific('D G C F A D', 6)).toBe('D4 A3 F3 C3 G2 D2');
    expect(ugTuningToScientific('Eb Ab Db Gb Bb Eb', 6)).toBe('D#4 A#3 F#3 C#3 G#2 D#2');
    expect(ugTuningToScientific('E A D G', 4)).toBe('G2 D2 A1 E1');
  });

  it('null when it does not fit', () => {
    expect(ugTuningToScientific('E A D G', 6)).toBeNull();
    expect(ugTuningToScientific('H A D G B E', 6)).toBeNull();
  });
});
