/** A stand-in for Songsterr's public search, so the tabs suites need no
 *  internet and can count how often Ember actually asks.
 *
 *      node tests/fake-songsterr.mjs [port]        # default 4330
 *
 *  Start the app with SONGSTERR_BASE=http://127.0.0.1:4330.
 *
 *  GET /api/songs?pattern=...   Songsterr's shape: songId, artist, title,
 *                               hasChords, tracks[{instrument, tuning,
 *                               difficulty}]. A pattern containing
 *                               "zzfail" answers 503.
 *  GET /__calls                 { count, patterns } since the last reset
 *  POST /__reset                clears the counter
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? process.env.FAKE_SONGSTERR_PORT ?? 4330);
let patterns = [];

const STANDARD = [64, 59, 55, 50, 45, 40];
const DROP_D = [64, 59, 55, 50, 45, 38];
const BASS = [43, 38, 33, 28];

/** Echo the pattern back as a song, so any title a test uses "exists". The
 *  first word is taken as the artist, the rest as the title. */
function songsFor(pattern) {
  const words = pattern.trim().split(/\s+/);
  const artist = words.length > 1 ? words[0] : 'Unknown';
  const title = words.length > 1 ? words.slice(1).join(' ') : words[0] ?? 'Song';
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/__calls') return send(200, { count: patterns.length, patterns });
  if (url.pathname === '/__reset' && req.method === 'POST') {
    patterns = [];
    return send(200, { ok: true });
  }
  if (url.pathname === '/api/songs') {
    const pattern = url.searchParams.get('pattern') ?? '';
    patterns.push(pattern);
    if (pattern.includes('zzfail')) return send(503, { error: 'busy' });
    return send(200, songsFor(pattern));
  }
  send(404, { error: 'not found' });
});

server.listen(port, '127.0.0.1', () => console.log(`listening ${port}`));
