/** A stand-in for Ultimate Guitar's search and tab pages, so the tab suites
 *  need no internet and can count how often Ember actually asks. It serves
 *  the fixtures in tests/fixtures/ug (UG's page shape, invented content).
 *
 *      node tests/fake-ug.mjs [port]        # default 4331
 *
 *  tests/fake-songsterr.mjs mounts the same handler under /ug, so one
 *  server can stand in for both sites (UG_BASE=http://127.0.0.1:4330/ug).
 *
 *  Start the app with UG_BASE=http://127.0.0.1:4331 (and TAB_FETCH_GAP_MS=0
 *  to skip the 2 s politeness gap in tests, optional).
 *
 *  GET /search.php?value=Q...   UG's search page. Only a query containing
 *                               "ugfetch" finds anything, so other suites'
 *                               songs stay tab-less: the fixture's results,
 *                               renamed to the query (first word the artist,
 *                               the rest the title, like fake-songsterr).
 *                               "zz429" answers 429, "zz403" 403, anything
 *                               else an empty result list.
 *  GET /tab/<artist>/<slug>-<id> the tab page tests/fixtures/ug/tab-<id>.html
 *  GET /__calls                 { count, searches, pages } since the last reset
 *  POST /__reset                clears the counters
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIST, SONG, escapeAttr } from './fixtures/ug/build.mjs';

const port = Number(process.argv[2] ?? process.env.FAKE_UG_PORT ?? 4331);
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ug');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');

let searches = [];
let pages = [];

/** The fixture search page with its song and band renamed, so any test
 *  song "exists" on the fake. */
function searchFor(query) {
  const words = query.trim().split(/\s+/);
  const artist = words.length > 1 ? words[0] : 'Unknown';
  const title = words.length > 1 ? words.slice(1).join(' ') : words[0];
  const html = read('search.html');
  const attr = /data-content="([^"]*)"/.exec(html)[1];
  const renamed = attr.split(escapeAttr(SONG)).join(escapeAttr(title)).split(escapeAttr(ARTIST)).join(escapeAttr(artist));
  return html.replace(attr, () => renamed);
}

/** Answers one request, with paths taken relative to `prefix` (the fake
 *  Songsterr mounts this under /ug so one server serves both sites).
 *  Returns false when the path is none of UG's. */
export function handleUg(req, res, url, prefix = '') {
  const send = (status, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
    return true;
  };
  const pathname = prefix && url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname;
  if (pathname === '/__calls') {
    return send(200, JSON.stringify({ count: searches.length + pages.length, searches, pages }), 'application/json');
  }
  if (pathname === '/__reset' && req.method === 'POST') {
    searches = [];
    pages = [];
    return send(200, '{"ok":true}', 'application/json');
  }
  if (pathname === '/search.php') {
    const q = url.searchParams.get('value') ?? '';
    searches.push({ q, types: url.searchParams.getAll('type[]'), ua: req.headers['user-agent'] ?? '' });
    if (q.includes('zz429')) return send(429, 'Too Many Requests');
    if (q.includes('zz403')) return send(403, 'Forbidden');
    if (!/ugfetch/i.test(q)) return send(200, read('search-empty.html'));
    return send(200, searchFor(q));
  }
  const tab = /^\/tab\/[^/]+\/[^/]+-(\d+)$/.exec(pathname);
  if (tab) {
    pages.push({ id: Number(tab[1]), path: pathname });
    const file = path.join(DIR, `tab-${tab[1]}.html`);
    if (fs.existsSync(file)) return send(200, fs.readFileSync(file, 'utf8'));
    return send(404, 'not found');
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  http
    .createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (handleUg(req, res, url)) return;
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('not found');
    })
    .listen(port, '127.0.0.1', () => console.log(`listening ${port}`));
}
