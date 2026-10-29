#!/usr/bin/env node
/** npm run host-check
 *
 *  Asks the live host which Ember it runs (GET /api/version) and which app
 *  version it offers (/api/app/update), and says whether ./update.sh is
 *  due. The host address comes from EMBER_HOST_URL in
 *  ~/.ember-tools/sandbox.env, else the usual tailnet address. */

import { hostVerdict } from './logic.mjs';
import { git, readEnvFile, say, TOOLS_DIR } from './lib.mjs';
import path from 'node:path';

const host = (readEnvFile(path.join(TOOLS_DIR, 'sandbox.env')).EMBER_HOST_URL ?? 'https://ember.tailf4de41.ts.net').replace(/\/$/, '');
git(['fetch', '-q', 'origin']);
const mainVersion = JSON.parse(git(['show', 'origin/main:apps/web/package.json'])).version;

async function json(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    return res.ok ? await res.json() : null;
  } catch {
    return undefined;
  }
}

const version = await json(`${host}/api/version`);
if (version === undefined) {
  say(`The host (${host}) does not answer. Is it on, and is this Mac on the tailnet?`);
  process.exit(1);
}
const verdict = hostVerdict(version?.version, mainVersion);
say(verdict.line);
const apps = await json(`${host}/api/app/update?platform=android&version=0.0.1`);
if (apps?.latest) say(`Apps offered to phones and desktops: ${apps.latest}`);
process.exit(verdict.due ? 2 : 0);
