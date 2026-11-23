import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { RouteNode } from './types';

/** Builds the app's route tree from the app/ folders, for
 *  lib/perf/routeTree.ts (its test checks the two still agree, and writes
 *  the file again with UPDATE_ROUTE_TREE=1). Node only: tests use it, the
 *  app never imports it. */

function merge(into: RouteNode, from: RouteNode): void {
  for (const [k, v] of Object.entries(from.s ?? {})) {
    into.s ??= {};
    if (into.s[k]) merge(into.s[k], v);
    else into.s[k] = v;
  }
  if (from.d) {
    if (into.d) merge(into.d, from.d);
    else into.d = from.d;
  }
  if (from.c) into.c = 1;
}

function walk(dir: string): RouteNode {
  const node: RouteNode = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    const child = walk(path.join(dir, name));
    // Route groups, parallel routes and private folders add no segment.
    if (/^\(.*\)$/.test(name) || name.startsWith('@')) merge(node, child);
    else if (name.startsWith('_')) continue;
    else if (/^\[\[?\.\.\./.test(name)) node.c = 1;
    else if (/^\[.*\]$/.test(name)) {
      if (node.d) merge(node.d, child);
      else node.d = child;
    } else {
      node.s ??= {};
      if (node.s[name]) merge(node.s[name], child);
      else node.s[name] = child;
    }
  }
  return node;
}

/** Sorted keys, so the written file is stable. */
function sorted(node: RouteNode): RouteNode {
  const out: RouteNode = {};
  if (node.s) out.s = Object.fromEntries(Object.keys(node.s).sort().map((k) => [k, sorted(node.s![k])]));
  if (node.d) out.d = sorted(node.d);
  if (node.c) out.c = 1;
  return out;
}

/** The tree of `appDir`, plus the paths next.config.ts rewrites: /pb (all
 *  of PocketBase, its rest shaped away) and /apk. */
export function buildRouteTree(appDir: string): RouteNode {
  const root = walk(appDir);
  root.s ??= {};
  root.s.pb = { c: 1 };
  root.s.apk = {};
  return sorted(root);
}
