import { ROUTE_TREE } from './routeTree';
import type { RouteNode } from './types';

/** A path with its ids and names taken out, so timings group by page or
 *  endpoint and never carry a song, playlist, artist or user. The path is
 *  walked down the app's own route tree (lib/perf/routeTree.ts, built from
 *  the app/ folders): a segment stays only where the app has a folder of
 *  that exact name; a dynamic segment ([id], [slug], ...) and anything the
 *  app does not know become `:id`. The query is dropped. */
export function routeShape(pathOrUrl: string, tree: RouteNode = ROUTE_TREE): string {
  let path = pathOrUrl;
  const q = path.search(/[?#]/);
  if (q >= 0) path = path.slice(0, q);
  if (/^[a-z]+:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '/:id';
    }
  }
  if (path.startsWith('/_next/')) return path.startsWith('/_next/image') ? '/_next/image' : '/_next/static';
  const parts = path.split('/').filter(Boolean).slice(0, 8);
  const shaped: string[] = [];
  let node: RouteNode | undefined = tree;
  for (const seg of parts) {
    const fixed: RouteNode | undefined = node?.s?.[seg];
    if (fixed) {
      shaped.push(seg);
      node = fixed;
    } else if (node?.c) {
      // A catch-all takes the rest of the path.
      shaped.push(':id');
      break;
    } else {
      shaped.push(':id');
      node = node?.d;
    }
  }
  return '/' + shaped.join('/');
}

/** True for a request Next's router makes for a page's server data. */
export function isRscUrl(url: string): boolean {
  return /[?&]_rsc=/.test(url);
}
