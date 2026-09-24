// One setting from apps/web/.env*, read exactly the way the web app reads it
// (bughunt O3). Used by start-static.sh and update.sh.
//
//   node scripts/read-env.mjs <apps/web dir> KEY       the value, then "."
//   node scripts/read-env.mjs <apps/web dir> --check   exit 0 if Next's loader loads
//
// `next start` loads its env files with @next/env (dotenv + dotenv-expand):
// quotes, `#` comments, `export`, $VAR expansion, .env.local over .env. The
// scripts used to grep .env.local instead, so a password with a `$`, `#` or
// quote reached PocketBase as one value and the web app as another, and the
// app could no longer sign in to PocketBase. This asks Next's own loader, from
// Next's own install, so both always get the same value.
//
// The trailing "." survives the shell's command substitution, which would
// otherwise drop trailing newlines from the value; the scripts strip it.
// Prints nothing else, ever: the values are secrets. Exits 3 when Next is not
// installed (a fresh clone before npm ci); the scripts then fall back to their
// simple reader and say so.

import { createRequire } from 'node:module';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const key = process.argv[3];

let loadEnvConfig;
try {
  const nextPkg = createRequire(path.join(dir, 'package.json')).resolve('next/package.json');
  ({ loadEnvConfig } = createRequire(nextPkg)('@next/env'));
} catch {
  process.exit(3);
}
if (typeof loadEnvConfig !== 'function') process.exit(3);
if (key === '--check') process.exit(0);
if (!key) process.exit(2);

// The same call `next start` makes (next/dist/server/config.js): production
// mode, so .env.production.local, .env.local, .env.production, .env. A value
// already in the environment wins, as it does for Next. The loader's own
// messages name the file only, never a value.
loadEnvConfig(dir, false, {
  info() {},
  error(message) {
    process.stderr.write(`⚠ ${String(message)}\n`);
  },
});
process.stdout.write(`${process.env[key] ?? ''}.`);
