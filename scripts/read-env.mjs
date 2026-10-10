// One setting from apps/web/.env*, read exactly the way the web app reads it.
// Used by start-static.sh and update.sh, so PocketBase, the web app and the
// update script never disagree about a value (bughunt O3).
//
//   node scripts/read-env.mjs <apps/web dir> KEY
//
// `next start` loads its env files with @next/env: an unquoted `#` starts a
// comment, `$VAR` is expanded, quotes inside a value are kept, `export` is
// allowed, and .env.local wins over .env. A hand parse (grep | cut) got those
// wrong: a password with `#`, `$` or a quote reached PocketBase as one value
// and the web app as another, and a `PORT=3000 # web` line made update.sh
// look for Ember on a port called "3000 # web".
//
// Prints the value from the files only (the shell scripts decide whether an
// exported value wins), nothing else, ever: values are secrets. Exits 3 when
// Next is not installed (a fresh clone before npm ci); the scripts then fall
// back to their simple reader.

import { createRequire } from 'node:module';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const key = process.argv[3];
if (!key) process.exit(2);

let loadEnvConfig;
try {
  const require = createRequire(path.join(dir, 'package.json'));
  ({ loadEnvConfig } = require(require.resolve('@next/env', { paths: [dir] })));
} catch {
  process.exit(3);
}
if (typeof loadEnvConfig !== 'function') process.exit(3);

// The file's value, not one this process inherited.
delete process.env[key];
// The same call `next start` makes: production mode, so .env.production.local,
// .env.local, .env.production and .env. The loader's own messages name a file,
// never a value, and go nowhere.
loadEnvConfig(dir, false, { info() {}, error() {} }, true);
const value = process.env[key];
process.stdout.write(value == null ? '' : String(value));
