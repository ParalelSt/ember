/** Ultimate Guitar's public pages, read the way a browser reads them.
 *  Pure: no fetch, no Node. lib/tabFetch/online.ts
 *  does the asking.
 *
 *  Both the search page and a tab page carry their data as JSON in
 *  `<div class="js-store" data-content="...">`, HTML-escaped:
 *
 *   - search: `store.page.data.results[]` with id, type ("Tabs", "Bass Tabs",
 *     "Chords", "Pro", "Official"...), part ("" for the whole song, "intro",
 *     "solo"), version, rating, votes, tab_access_type, tab_url. Marketing
 *     rows for the app (no id, a /pro/ link) are mixed in.
 *   - tab page: `store.page.data.tab` (the same fields) and
 *     `store.page.data.tab_view`: `wiki_tab.content` (the text, with
 *     `[tab]..[/tab]` and `[ch]..[/ch]` marks, `\r\n` lines) and
 *     `meta.tuning` ({ name, value: "D G C F A D", low string first }).
 *
 *  Only free text tabs are used: "Tabs" and "Bass Tabs" with a public
 *  access type. Guitar Pro, Official and Pro tabs are the app's, behind a
 *  login: they stay a link-out. */

import { parseTabText, type TabTextResult } from '@/lib/tabText';

/** The two search types Ember asks for: 200 Tab, 400 Bass Tab. */
export const UG_SEARCH_TYPES = [200, 400] as const;

/** Which instrument a tab is for, from UG's type. */
export type UgPart = 'guitar' | 'bass';

export interface UgResult {
  id: number;
  part: UgPart;
  songName: string;
  artistName: string;
  /** "" for the whole song, else the part it covers ("intro", "solo"). */
  section: string;
  version: number;
  rating: number;
  votes: number;
  url: string;
}

export interface UgTabPage extends UgResult {
  /** UG's tuning, low string first ("D G C F A D"), and its name. */
  tuning: { name: string; value: string } | null;
  capo: number;
  /** The tab text with UG's marks removed. */
  text: string;
}

/** "Enough votes" for a rating to count (the Tab
 *  with the most votes and rating 4+). */
export const MIN_VOTES = 5;
export const MIN_RATING = 4;

// ── HTML ──────────────────────────────────────────────────────────────────

/** Named entities by code point (the page uses a handful). */
const NAMED_CODES: Record<string, number> = {
  quot: 0x22, amp: 0x26, lt: 0x3c, gt: 0x3e, apos: 0x27, nbsp: 0xa0,
  rsquo: 0x2019, lsquo: 0x2018, rdquo: 0x201d, ldquo: 0x201c, hellip: 0x2026,
  ndash: 0x2013, mdash: 0x2014, laquo: 0xab, raquo: 0xbb, copy: 0xa9, reg: 0xae,
  trade: 0x2122, deg: 0xb0, middot: 0xb7, times: 0xd7, divide: 0xf7,
  iexcl: 0xa1, iquest: 0xbf, szlig: 0xdf, AElig: 0xc6, aelig: 0xe6, Oslash: 0xd8, oslash: 0xf8,
};
/** Latin-1 letters by name ("Eacute"): the letter plus a combining mark. */
const ACCENTS: Record<string, number> = { grave: 0x300, acute: 0x301, circ: 0x302, tilde: 0x303, uml: 0x308, ring: 0x30a, cedil: 0x327 };

function named(name: string): string | null {
  if (name in NAMED_CODES) return String.fromCodePoint(NAMED_CODES[name]);
  const m = /^([A-Za-z])(grave|acute|circ|tilde|uml|ring|cedil)$/.exec(name);
  if (m) return (m[1] + String.fromCodePoint(ACCENTS[m[2]])).normalize('NFC');
  return null;
}

/** Undo the HTML escaping of an attribute value. Unknown names stay as
 *  written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return named(body) ?? whole;
  });
}

/** The page's js-store JSON, or null when the page has none (a block page,
 *  a captcha, a redesign). */
export function readJsStore(html: string): Record<string, unknown> | null {
  const m = /<div[^>]*class="js-store"[^>]*data-content="([^"]*)"/.exec(html);
  if (!m) return null;
  try {
    const json = JSON.parse(decodeEntities(m[1]));
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pageData(html: string): Record<string, unknown> | null {
  const store = readJsStore(html);
  const data = (store?.store as { page?: { data?: unknown } } | undefined)?.page?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

// ── search ────────────────────────────────────────────────────────────────

const TAB_HOSTS = new Set(['tabs.ultimate-guitar.com', 'www.ultimate-guitar.com', 'ultimate-guitar.com']);

/** A tab page URL Ember will fetch: https on UG's own hosts, under /tab/.
 *  Anything else (the app's /pro/ links, another host) is refused. */
export function isTabUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TAB_HOSTS.has(u.hostname) && u.pathname.startsWith('/tab/');
  } catch {
    return false;
  }
}

function partOf(type: unknown): UgPart | null {
  if (type === 'Tabs' || type === 'Tab') return 'guitar';
  if (type === 'Bass Tabs' || type === 'Bass Tab') return 'bass';
  return null;
}

/** One result row, or null when Ember cannot use it: not a free text tab
 *  (Chords, Pro, Official, Video, a paid access type, the app's marketing
 *  rows), or no usable link. */
export function toResult(raw: unknown): UgResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const part = partOf(r.type);
  if (!part || typeof r.id !== 'number' || !Number.isInteger(r.id)) return null;
  if (r.tab_access_type !== 'public') return null;
  if (r.marketing_type) return null;
  const url = typeof r.tab_url === 'string' ? r.tab_url : '';
  if (!isTabUrl(url)) return null;
  return {
    id: r.id,
    part,
    songName: typeof r.song_name === 'string' ? r.song_name : '',
    artistName: typeof r.artist_name === 'string' ? r.artist_name : '',
    section: typeof r.part === 'string' ? r.part.trim().toLowerCase() : '',
    version: Number.isInteger(r.version) ? (r.version as number) : 1,
    rating: typeof r.rating === 'number' && Number.isFinite(r.rating) ? r.rating : 0,
    votes: typeof r.votes === 'number' && Number.isFinite(r.votes) ? Math.max(0, Math.round(r.votes)) : 0,
    url,
  };
}

/** Every usable result of a search page, in UG's order. Null when the page
 *  is not a search page Ember can read (the caller must not remember that
 *  as "nothing found"). */
export function parseUgSearch(html: string): UgResult[] | null {
  const data = pageData(html);
  if (!data || !Array.isArray(data.results)) return null;
  return (data.results as unknown[]).map(toResult).filter((r): r is UgResult => r !== null);
}

/** The search page for a song: title search, text tabs and bass tabs in one
 *  request. */
export function ugSearchUrl(base: string, query: string): string {
  const types = UG_SEARCH_TYPES.map((t) => `&type%5B%5D=${t}`).join('');
  return `${base.replace(/\/+$/, '')}/search.php?search_type=title&value=${encodeURIComponent(query)}${types}`;
}

/** What Ember searches for: "artist title" without the version noise that
 *  makes UG's title search miss ("(Remastered 2011)", "[Official Video]",
 *  "feat. X", " - Live"). */
export function ugQuery(title: string, artist: string): string {
  const t = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s\p{Pd}\s.*$/u, ' ')
    .replace(/\b(feat|ft|featuring)\b\.?.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const a = artist.replace(/\s*-\s*topic\s*$/i, '').replace(/\bvevo\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const known = a && !/^unknown( artist)?$/i.test(a);
  return `${known ? `${a} ` : ''}${t || title.trim()}`.slice(0, 200);
}

/** The words of a title or a name, in any script: letters and digits of
 *  every alphabet (Japanese, Cyrillic, Greek, accented Latin), split on
 *  anything else. It used to keep [a-z0-9] only, so a title in Japanese had
 *  no words at all and no search result could ever be "this song": every
 *  such song was recorded as "nothing on Songsterr". Single letters go
 *  (noise in Latin titles) unless they are not ASCII (one kanji is a word). */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && (w.length > 1 || /[^\x00-\x7f]/.test(w)) && w !== 'the');
}

/** A title and, when it is written "original / romanized" (Songsterr's way
 *  with Japanese titles: "黄泉より聴こゆ… / Yomi Yori Kikoyu…"), each side. */
export function titleForms(title: string): string[] {
  const parts = title
    .split(/\s+[/／]\s+|／/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? [title, ...parts] : [title];
}

/** The same title: the same words, or the same letters once spacing and
 *  punctuation are gone ("Yomiyori" and "Yomi yori"). */
function sameTitle(a: string, b: string): boolean {
  const want = words(a);
  const got = words(b);
  if (want.length === 0 || got.length === 0) return false;
  const w = new Set(want);
  const g = new Set(got);
  if (w.size === g.size && [...w].every((x) => g.has(x))) return true;
  return want.join('') === got.join('');
}

/** Is this result the song asked for? The title's words must be the same
 *  (anything in brackets aside: UG's search is loose, a longer title is
 *  another song; either side of an "original / romanized" title will do),
 *  and a known artist must share a word (another band's song of the same
 *  name is not this one). */
export function sameSong(r: Pick<UgResult, 'songName' | 'artistName'>, title: string, artist: string): boolean {
  const wanted = titleForms(title).map((t) => ugQuery(t, ''));
  const offered = titleForms(r.songName);
  if (!wanted.some((w) => offered.some((o) => sameTitle(w, o)))) return false;
  const a = words(artist.replace(/\s*-\s*topic\s*$/i, ''));
  if (a.length === 0 || /^unknown( artist)?$/i.test(artist.trim())) return true;
  const ra = new Set(words(r.artistName));
  return a.some((w) => ra.has(w));
}

/** Ranking inside one part (guitar or bass), best first:
 *   1. whole-song tabs rated 4+ with enough votes,
 *   2. partial tabs (an intro, a solo) rated 4+ with enough votes,
 *   3. everything else;
 *  then the most votes, then the higher rating, then the lower version. */
export function rankUg(results: UgResult[]): UgResult[] {
  const trusted = (r: UgResult) => r.rating >= MIN_RATING && r.votes >= MIN_VOTES;
  const tier = (r: UgResult) => (trusted(r) ? (r.section === '' ? 0 : 1) : 2);
  return [...results].sort(
    (a, b) => tier(a) - tier(b) || b.votes - a.votes || b.rating - a.rating || a.version - b.version || a.id - b.id,
  );
}

/** The candidates for a song, best first per part: guitar tabs, bass tabs. */
export function chooseUg(
  results: UgResult[],
  song: { title: string; artist: string },
): Record<UgPart, UgResult[]> {
  const mine = results.filter((r) => sameSong(r, song.title, song.artist));
  return {
    guitar: rankUg(mine.filter((r) => r.part === 'guitar')),
    bass: rankUg(mine.filter((r) => r.part === 'bass')),
  };
}

// ── a tab page ────────────────────────────────────────────────────────────

/** UG's text to plain tab text: `[tab]`/`[/tab]` go, `[ch]G[/ch]` keeps
 *  the chord name, Windows line ends become plain ones. */
export function stripUgMarks(content: string): string {
  return content
    .replace(/\[\/?tab\]/gi, '')
    .replace(/\[ch\]([^[]*)\[\/ch\]/gi, '$1')
    .replace(/\[\/?(?:ch|b|i|u)\]/gi, '')
    .replace(/\r\n?/g, '\n');
}

/** The tab page, or null when it is not a free text tab page Ember can
 *  read. */
export function parseUgTabPage(html: string): UgTabPage | null {
  const data = pageData(html);
  if (!data) return null;
  const result = toResult(data.tab);
  const view = data.tab_view as Record<string, unknown> | undefined;
  const wiki = view?.wiki_tab as Record<string, unknown> | undefined;
  if (!result || typeof wiki?.content !== 'string') return null;
  const meta = (view?.meta ?? {}) as Record<string, unknown>;
  const t = meta.tuning as Record<string, unknown> | undefined;
  const tuning =
    t && typeof t.value === 'string' && t.value.trim()
      ? { name: typeof t.name === 'string' ? t.name : '', value: t.value.trim() }
      : null;
  const capo = Number.isInteger(meta.capo) ? Math.max(0, Math.min(24, meta.capo as number)) : 0;
  return { ...result, tuning, capo, text: stripUgMarks(wiki.content) };
}

// ── tuning ────────────────────────────────────────────────────────────────

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Standard tuning per string count, MIDI, LOW string first. */
const STANDARD: Record<number, number[]> = {
  4: [28, 33, 38, 43],
  5: [23, 28, 33, 38, 43],
  6: [40, 45, 50, 55, 59, 64],
  7: [35, 40, 45, 50, 55, 59, 64],
};

/** UG's tuning ("D G C F A D", low string first, no octaves) as the
 *  parser's override ("D4 A3 F3 C3 G2 D2", high string first), each note
 *  placed in the octave nearest the standard string (a tie goes down: drop
 *  tunings drop). Null when it does not fit the tab's string count or
 *  cannot be read. */
export function ugTuningToScientific(value: string, strings: number): string | null {
  const std = STANDARD[strings];
  const notes = value.trim().split(/\s+/);
  if (!std || notes.length !== strings) return null;
  const out: string[] = [];
  for (let i = 0; i < strings; i++) {
    const m = /^([A-Ga-g])([#b]?)$/.exec(notes[i]);
    if (!m) return null;
    const pc = (PITCH[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12;
    let best = -1;
    for (let midi = std[i] - 12; midi <= std[i] + 12; midi++) {
      if (midi % 12 !== pc) continue;
      if (best < 0 || Math.abs(midi - std[i]) < Math.abs(best - std[i])) best = midi;
    }
    out.push(`${NAMES[best % 12]}${Math.floor(best / 12) - 1}`);
  }
  return out.reverse().join(' ');
}

// ── to alphaTex ───────────────────────────────────────────────────────────

/** A fetched tab page through the text tab parser (lib/tabText.ts), the
 *  same one a paste goes through. The tempo is the tab's own (a Tempo line)
 *  or the parser's default; the tab's string labels give the tuning, and
 *  UG's tuning fills in only when the text has none. */
export function ugTabToAlphaTex(page: UgTabPage, song: { title: string; artist: string }): TabTextResult {
  const opts = { title: song.title, artist: song.artist };
  const first = parseTabText(page.text, opts);
  if (!first.ok || !page.tuning) return first;
  if (!first.report.warnings.some((w) => /standard tuning is assumed/.test(w))) return first;
  const tuning = ugTuningToScientific(page.tuning.value, first.report.strings);
  if (!tuning) return first;
  const again = parseTabText(page.text, { ...opts, tuning });
  return again.ok ? again : first;
}
