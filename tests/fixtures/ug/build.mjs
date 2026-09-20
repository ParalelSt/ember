/** Builds the Ultimate Guitar fixtures in this folder:
 *
 *      node tests/fixtures/ug/build.mjs
 *
 *  The SHAPE is Ultimate Guitar's as a browser got it on 2026-09-19 (one
 *  search page with `type[]=200&type[]=400`, one tab page): the HTML-escaped
 *  JSON in `<div class="js-store" data-content="...">`, the key names, the
 *  marketing rows without an id, `part` for partial tabs, `[tab]`/`[ch]`
 *  marks and `\r\n` line ends in `wiki_tab.content`, `meta.tuning` low
 *  string first. EVERY title, artist, name and note here is invented for
 *  Ember's tests: "The Lantern Keepers" and their riffs do not exist, and no
 *  real tab text is stored.
 *
 *  Files:
 *    search.html          a title search: text tabs, bass tabs, plus rows
 *                         Ember must skip (Pro, Official, Chords, marketing,
 *                         a paid access type, another band's song, a longer
 *                         title)
 *    tab-9100001.html     the whole song, guitar, Drop D labels, Tempo 100
 *    tab-9100002.html     an intro only (more votes than 9100001)
 *    tab-9100011.html     the bass tab
 *    tab-9100003.html     a "tab" with no notes (chord names only) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const DIR = path.dirname(HERE);
export const ARTIST = 'The Lantern Keepers';
export const SONG = 'Harbour Lights';
const ARTIST_SLUG = 'the-lantern-keepers';
const SONG_SLUG = 'harbour-lights';

/** The escaping UG uses for the attribute: quotes, ampersands, angle
 *  brackets, apostrophes, and a named entity for an accented letter. */
export function escapeAttr(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#039;')
    .replace(/é/g, '&eacute;');
}

export function page(title, data) {
  const store = {
    config: { releaseVersion: 'fixture' },
    store: {
      offers: {},
      page: { data, header_bidding: {}, experiments: {}, seoAbVariation: null, template: { module: 'fixture' }, documents: [] },
      i18n: {},
      user: { id: 0 },
      config: {},
    },
    globalHelpers: {},
    helpers: {},
  };
  return `<!doctype html>
<html lang="en">
<head>
    <meta content="text/html; charset=utf-8" http-equiv="Content-Type">
    <title>${title}</title>
</head>
<body>
    <div class="js-page js-global-wrapper ug-page">
        </div>

    <div class="js-store" data-content="${escapeAttr(JSON.stringify(store))}"></div>
</body>
</html>
`;
}

const tabUrl = (kind, id, artist = ARTIST_SLUG, song = SONG_SLUG) =>
  `https://tabs.ultimate-guitar.com/tab/${artist}/${song}-${kind}-${id}`;

function result({ id, type, part = '', version = 1, rating, votes, access = 'public', song = SONG, artist = ARTIST, kind = 'tabs' }) {
  return {
    id,
    song_id: 7700001,
    song_name: song,
    artist_id: 880001,
    artist_name: artist,
    type,
    part,
    version,
    common_version: 1,
    votes,
    difficulty: '',
    rating,
    date: '1700000000',
    status: 'approved',
    preset_id: 0,
    tab_access_type: access,
    tp_version: 0,
    tonality_name: '',
    version_description: '',
    verified: 0,
    recording: { is_acoustic: 0, tonality_name: '', performance: null, recording_artists: [], video_urls: null, album_id: 0 },
    album_cover: { has_album_cover: false, web_album_cover: { small: '' } },
    artist_cover: { has_artist_cover: false, web_artist_cover: { small: '' } },
    unique_chords: '',
    ug_difficulty: '',
    date_update: 1700000000,
    source: '',
    typeLabel: null,
    artist_url: `https://www.ultimate-guitar.com/artist/${ARTIST_SLUG}_880001`,
    tab_url: tabUrl(kind, id, artist === ARTIST ? ARTIST_SLUG : 'quiet-engine', song === SONG ? SONG_SLUG : 'harbour-lights-reprise'),
    localized_song_name: song,
    localized_artist_name: artist,
  };
}

const marketing = {
  artist_name: ARTIST,
  artist_id: 880001,
  artist_url: `/artist/${ARTIST_SLUG}_880001`,
  song_name: SONG,
  marketing_type: 'official',
  tab_id: 9100031,
  tab_url: 'https://www.ultimate-guitar.com/pro/?app_utm_source=UltimateGuitar&tab_id=9100031',
  device: null,
  app_link: '//www.ultimate-guitar.com/send?ug_from=fixture',
  tracks: 'Electric Guitar (clean), Electric Bass (finger), Drums',
  duration: '3:30',
};

export const RESULTS = [
  marketing,
  result({ id: 9100002, type: 'Tabs', part: 'intro', version: 2, rating: 4.83, votes: 2400 }),
  result({ id: 9100001, type: 'Tabs', rating: 4.71, votes: 512 }),
  result({ id: 9100003, type: 'Tabs', version: 3, rating: 5, votes: 2 }),
  result({ id: 9100004, type: 'Tabs', version: 4, rating: 3.6, votes: 900 }),
  result({ id: 9100005, type: 'Tabs', version: 5, rating: 4.9, votes: 700, access: 'premium' }),
  result({ id: 9100011, type: 'Bass Tabs', rating: 4.6, votes: 140, kind: 'bass' }),
  result({ id: 9100012, type: 'Bass Tabs', version: 2, rating: 4.95, votes: 3, kind: 'bass' }),
  result({ id: 9100021, type: 'Pro', rating: 4.9, votes: 800, kind: 'guitar-pro' }),
  result({ id: 9100031, type: 'Official', rating: 4.8, votes: 3000, kind: 'official' }),
  result({ id: 9100041, type: 'Chords', rating: 4.9, votes: 5000, kind: 'chords' }),
  result({ id: 9100051, type: 'Tabs', rating: 4.9, votes: 5000, artist: 'Quiet Engine' }),
  result({ id: 9100061, type: 'Tabs', rating: 4.9, votes: 4000, song: 'Harbour Lights Reprise' }),
];

function searchData(results) {
  return {
    search_query: `${ARTIST} ${SONG}`.toLowerCase(),
    search_query_type: 'tabs',
    results_count: results.filter((r) => r.id).length,
    results,
    pagination: { total: 1, current: 1 },
    spellcheck: null,
    not_found: results.length === 0,
    order: [{ name: 'Relevance', is_current: true, url: '/search.php?order=myweight' }],
    filters: { types: [{ name: 'Tab', url: '/search.php?type=200', count: 6 }] },
  };
}

// ── invented tab texts ────────────────────────────────────────────────────

const crlf = (lines) => lines.join('\r\n');

/** The whole song: four bars of riff played ten times, Drop D, 100 bpm. */
const GUITAR = crlf([
  `${SONG} - ${ARTIST} (an invented song for Ember's tests)`,
  'Tempo: 100',
  'Tuning: Drop D',
  '',
  '[Intro]',
  '[tab]e|-----------------|-----------------|-----------------|-----------------|',
  'B|-----------------|-----------------|-----------------|-----------------|',
  'G|-----------------|-----------------|---------4---2---|-----------------|',
  'D|-0---3---5---3---|-0-0-0-0-3---5---|-0---3-----------|-7---5---3---0---|',
  'A|-----------------|-----------------|-----------------|-----------------|',
  'D|-0---------------|-0---------------|-0---------------|-0---------------|[/tab]',
  'x10',
  '',
  '[Verse]',
  '[ch]D5[/ch]       [ch]F5[/ch]         [ch]G5[/ch]',
  'Lanterns on the water, nobody at the café',
  '',
  'Let the open D ring under the riff.',
]);

/** Only the intro: two bars. */
const INTRO = crlf([
  '[Intro]',
  '[tab]e|-----------------|-----------------|',
  'B|-----------------|-----------------|',
  'G|-----------------|-----------------|',
  'D|-0---3---5---3---|-0-0-0-0-3---5---|',
  'A|-----------------|-----------------|',
  'D|-0---------------|-0---------------|[/tab]',
]);

/** The bass: root notes, four strings. */
const BASS = crlf([
  `${SONG} bass (invented)`,
  'Tempo: 100',
  '',
  '[tab]G|-----------------|-----------------|-----------------|-----------------|',
  'D|-----------------|-----------------|-----------------|-----------------|',
  'A|-----------------|-----------------|-----------------|-----------------|',
  'E|-0---0---3---3---|-5---5---3---3---|-0---0---3---5---|-7---5---3---0---|[/tab]',
  'x10',
]);

/** Chord names and words only: nothing a tab parser can draw. */
const NO_NOTES = crlf(['[Verse]', '[ch]D5[/ch]   [ch]F5[/ch]   [ch]G5[/ch]', 'Lanterns on the water', '[Chorus]', '[ch]A5[/ch]   [ch]C5[/ch]']);

function tabData(r, content, tuning) {
  return {
    headerMeta: {},
    tab: { ...r, user_id: 1, user_iq: 1, username: 'fixture_tabber', type_name: r.type === 'Bass Tabs' ? 'Bass Tab' : 'Tab' },
    tab_view: {
      wiki_tab: { content, revision_id: 1, user_id: 1, username: 'fixture_tabber', date: 1700000000 },
      contributors: [],
      strummings: [],
      meta: tuning ? { tuning } : {},
      versions: [],
      stats: { view_total: 1234, favorites_count: 56 },
      blocked: false,
    },
    access: { can_edit_tab: false },
  };
}

const byId = (id) => RESULTS.find((r) => r.id === id);
const DROP_D = { name: 'Drop D', value: 'D A D G B E', index: 2 };
const BASS_STD = { name: 'Standard', value: 'E A D G', index: 0 };

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  const write = (name, html) => fs.writeFileSync(path.join(DIR, name), html);
  write('search.html', page(`${ARTIST} ${SONG}, chords &amp; tabs found @ Ultimate-Guitar.Com Search`, searchData(RESULTS)));
  write('search-empty.html', page('Nothing found @ Ultimate-Guitar.Com Search', searchData([])));
  write('tab-9100001.html', page(`${SONG.toUpperCase()} TAB by ${ARTIST}`, tabData(byId(9100001), GUITAR, DROP_D)));
  write('tab-9100002.html', page(`${SONG.toUpperCase()} TAB by ${ARTIST}`, tabData(byId(9100002), INTRO, DROP_D)));
  write('tab-9100011.html', page(`${SONG.toUpperCase()} BASS by ${ARTIST}`, tabData(byId(9100011), BASS, BASS_STD)));
  write('tab-9100003.html', page(`${SONG.toUpperCase()} TAB by ${ARTIST}`, tabData(byId(9100003), NO_NOTES, null)));
  console.log('fixtures written to', DIR);
}
