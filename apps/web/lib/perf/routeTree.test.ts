// @vitest-environment node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRouteTree } from './routeTreeBuild';
import { ROUTE_TREE } from './routeTree';

/** routeTree.ts is the app/ folders written down, so the browser can shape
 *  paths without a filesystem. A new route folder makes this fail until the
 *  file is written again:
 *
 *      UPDATE_ROUTE_TREE=1 ../../node_modules/.bin/vitest run lib/perf/routeTree.test.ts */

const WEB = path.resolve(__dirname, '../..');

describe('ROUTE_TREE', () => {
  it('matches the app/ route folders', () => {
    const built = buildRouteTree(path.join(WEB, 'app'));
    if (process.env.UPDATE_ROUTE_TREE === '1') {
      writeFileSync(
        path.join(__dirname, 'routeTree.ts'),
        `import type { RouteNode } from './types';\n\n/** Written by lib/perf/routeTree.test.ts from the app/ folders (UPDATE_ROUTE_TREE=1).\n *  Do not edit by hand. */\nexport const ROUTE_TREE: RouteNode = ${JSON.stringify(built)};\n`,
      );
      return;
    }
    expect(ROUTE_TREE).toEqual(built);
  });
});
