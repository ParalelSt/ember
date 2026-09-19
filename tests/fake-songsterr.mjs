/** A stand-in for Songsterr, so the tabs suites need no internet and can
 *  count how often Ember actually asks. It serves the fixtures in
 *  tests/fixtures/songsterr (Songsterr's shapes, invented content) and, so
 *  one server covers both tab sites, mounts tests/fake-ug.mjs under /ug.
 *
 *      node tests/fake-songsterr.mjs [port]        # default 4330
 *
 *  Start the app with SONGSTERR_BASE=http://127.0.0.1:4330,
 *  SONGSTERR_CDN_BASE=http://127.0.0.1:4330/cdn and, for the fake Ultimate
 *  Guitar, UG_BASE=http://127.0.0.1:4330/ug.
 *
 *  GET /api/songs?pattern=...   Songsterr's search shape. A pattern with
 *                               "ssfetch" answers with the fixture song
 *                               (renamed to the pattern, so any test song
 *                               "exists" with notes); any other pattern
 *                               gets the old echo, one song with tracks but
 *                               no page, so other suites find nothing to
 *                               fetch. "zzfail" answers 503.
 *  GET /a/wsa/<slug>-tab-s<id>  the song page, state JSON inside, for the
 *                               fixture song only; 404 otherwise.
 *  GET /cdn/<song>/<rev>/<image>/<part>.json   a part's notes.
 *  GET /ug/...                  the fake Ultimate Guitar (tests/fake-ug.mjs)
 *  GET /__calls                 { count, patterns, pages, parts }
 *  POST /__reset                clears the counters (both sites)
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { handleUg } from './fake-ug.mjs';
import { ARTIST, IMAGE, PARTS, REVISION_ID, SONG, SONG_ID, search, songPage, state } from './fixtures/songsterr/build.mjs';

const port = Number(process.argv[2] ?? process.env.FAKE_SONGSTERR_PORT ?? 4330);
let patterns = [];
let pages = [];
let parts = [];
/** What the fixture song was last renamed to (the last "ssfetch" search),
 *  so its page carries the same name. */
let called = { artist: ARTIST, title: SONG };

const STANDARD = [64, 59, 55, 50, 45, 40];
const DROP_D = [64, 59, 55, 50, 45, 38];
const BASS = [43, 38, 33, 28];

/** The artist and title a pattern stands for: the first word is the artist,
 *  the rest the title (as the fake Ultimate Guitar does). */
function named(pattern) {
  const words = pattern.trim().split(/\s+/);
  return words.length > 1
    ? { artist: words[0], title: words.slice(1).join(' ') }
    : { artist: 'Unknown', title: words[0] ?? 'Song' };
}

/** Echo the pattern back as a song, so any title a test uses "exists" for
 *  the link-out list. No song page goes with it. */
function echo(pattern) {
  const { artist, title } = named(pattern);
  return [
    {
      songId: 1000 + (pattern.length % 97),
      artist,
      title,
      hasChords: true,
      tracks: [
        { instrument: 'Electric Guitar (distortion)', tuning: DROP_D, difficulty: 3, views: 10 },
        { instrument: 'Electric Guitar (clean)', tuning: STANDARD, difficulty: 2 },
        { instrument: 'Electric Bass (finger)', tuning: BASS, difficulty: 1 },
      ],
    },
  ];
}

/** The fixture song, renamed to the pattern. */
const renamed = (value, { artist, title }) =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(SONG).slice(1, -1)).join(title).split(JSON.stringify(ARTIST).slice(1, -1)).join(artist));

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/ug')) {
    if (handleUg(req, res, url, '/ug')) return;
  }
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (url.pathname === '/__calls') return send(200, { count: patterns.length + pages.length + parts.length, patterns, pages, parts });
  if (url.pathname === '/__reset' && req.method === 'POST') {
    patterns = [];
    pages = [];
    parts = [];
    handleUg(req, res, new URL('/__reset', url), '');
    return;
  }
  if (url.pathname === '/api/songs') {
    const pattern = url.searchParams.get('pattern') ?? '';
    patterns.push(pattern);
    if (pattern.includes('zzfail')) return send(503, { error: 'busy' });
    if (/ssfetch/i.test(pattern)) {
      called = named(pattern);
      return send(200, renamed(search(), called));
    }
    return send(200, echo(pattern));
  }
  const page = /^\/a\/wsa\/.+-tab-s(\d+)$/.exec(url.pathname);
  if (page) {
    const id = Number(page[1]);
    pages.push({ id, path: url.pathname });
    if (id !== SONG_ID) return send(404, 'not found', 'text/html');
    return send(200, songPage(renamed(state(), called)), 'text/html; charset=utf-8');
  }
  const part = /^\/cdn\/(\d+)\/(\d+)\/([\w-]+)\/(\d+)\.json$/.exec(url.pathname);
  if (part) {
    const [, song, revision, image, id] = part;
    parts.push({ song: Number(song), part: Number(id) });
    if (Number(song) !== SONG_ID || Number(revision) !== REVISION_ID || image !== IMAGE || !PARTS[id]) {
      return send(404, { error: 'not found' });
    }
    return send(200, PARTS[id]);
  }
  send(404, { error: 'not found' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => console.log(`listening ${port}`));
}
