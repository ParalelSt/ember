/** Stand-in for open.spotify.com in tests: the embed page and oEmbed, served
 *  from saved fixtures, so no test reaches Spotify.
 *
 *      node tests/fake-spotify.mjs            # standalone, port 4331
 *      FAKE_SPOTIFY_PORT=4400 node tests/fake-spotify.mjs
 *
 *  Point the app at it with SPOTIFY_EMBED_BASE=http://127.0.0.1:4331.
 *
 *  - GET /embed/playlist/<id>: the saved embed page for a known id; for any
 *    other id Spotify's own "Page not found" state (HTTP 200, like the real
 *    site). BROKEN_ID serves a page with no playlist data at all, the shape a
 *    Spotify redesign would leave behind.
 *  - GET /oembed?url=https://open.spotify.com/playlist/<id>: name and cover
 *    for a known id, 404 otherwise (as the real endpoint does).
 *  - GET /__requests: every path requested so far, for assertions. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'imports');

export const TOP_HITS_ID = '37i9dQZF1DXcBWIGoYBM5M';
export const EIGHTIES_ID = '37i9dQZF1DX4UtSsGT1Sbe';
export const BROKEN_ID = '0000000000000000broken';

const PLAYLISTS = {
  [TOP_HITS_ID]: {
    file: 'spotify-embed-todays-top-hits.html',
    title: 'Today’s Top Hits',
    thumbnail: 'https://i.scdn.co/image/ab67706f00000002622db66d648829915229cb74',
  },
  [EIGHTIES_ID]: {
    file: 'spotify-embed-all-out-80s.html',
    title: 'All Out 80s',
    thumbnail: 'https://i.scdn.co/image/ab67706f00000002fake80s',
  },
};

export function startFakeSpotify(port = Number(process.env.FAKE_SPOTIFY_PORT ?? 4331)) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname === '/__requests') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(requests));
      return;
    }
    requests.push(`${url.pathname}${url.search}`);

    const embed = /^\/embed\/playlist\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (embed) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (embed[1] === BROKEN_ID) {
        res.end('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
        return;
      }
      const known = PLAYLISTS[embed[1]];
      res.end(fs.readFileSync(path.join(FIXTURES, known ? known.file : 'spotify-embed-not-found.html')));
      return;
    }

    if (url.pathname === '/oembed') {
      const id = /\/playlist\/([A-Za-z0-9]+)/.exec(url.searchParams.get('url') ?? '')?.[1];
      const known = id && PLAYLISTS[id];
      if (!known) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        type: 'rich',
        version: '1.0',
        provider_name: 'Spotify',
        title: known.title,
        thumbnail_url: known.thumbnail,
        thumbnail_width: 300,
        thumbnail_height: 300,
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port, requests }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { port } = await startFakeSpotify();
  console.log(`fake Spotify on http://127.0.0.1:${port}`);
}
