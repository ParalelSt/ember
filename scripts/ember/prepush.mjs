#!/usr/bin/env node
/** The pre-push check (.githooks/pre-push, installed by `npm run hooks`).
 *  Git hands it one line per ref being pushed on stdin; it scans the lines
 *  those commits add and stops the push when one would leak a secret, has an
 *  em dash, or names pranks in What's new. */

import { scanAddedLines } from './logic.mjs';
import { git, tryGit } from './lib.mjs';

const ZERO = /^0+$/;
let input = '';
for await (const chunk of process.stdin) input += chunk;

const problems = [];
for (const line of input.split('\n').filter(Boolean)) {
  const [, localSha, , remoteSha] = line.split(' ');
  if (ZERO.test(localSha)) continue; // a branch being deleted
  // A new branch on GitHub: compare with main.
  const base = ZERO.test(remoteSha) ? (tryGit(['merge-base', 'origin/main', localSha]) ?? localSha) : remoteSha;
  if (base === localSha) continue;
  problems.push(...scanAddedLines(git(['diff', '-U0', '--no-color', base, localSha])));
}

if (problems.length) {
  console.error('✗ Push stopped:');
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  console.error('Fix these and push again.');
  process.exit(1);
}
