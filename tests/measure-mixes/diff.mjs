#!/usr/bin/env node
// Compares two mix measurement runs (tests/measure-mixes/README.md) and
// prints the report; with a third argument, also writes it there.
//
//   node tests/measure-mixes/diff.mjs <a.json> <b.json> [summary.txt]
//
// The comparison itself is apps/web/lib/mixes/sim/diff.ts (unit tested),
// loaded through node's own TypeScript type stripping.
import { readFileSync, writeFileSync } from 'node:fs';
import { diffRuns, formatDiff } from '../../apps/web/lib/mixes/sim/diff.ts';

const [a, b, out] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: diff.mjs <a.json> <b.json> [summary.txt]');
  process.exit(2);
}
const text = formatDiff(diffRuns(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8'))));
if (out) writeFileSync(out, `${text}\n`);
console.log(text);
