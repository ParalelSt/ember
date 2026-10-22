#!/usr/bin/env node
/** npm run ember: every Ember tool on one list. Pick a number and it asks
 *  for anything it needs. With nobody at the terminal it only prints the
 *  list. Instructions for each: docs/automation.md. */

import { ask, interactive, say, sh } from './lib.mjs';

export const TOOLS = [
  ['branch', 'New branch in its own folder', 'Branch name (e.g. fix/search-crash):'],
  ['sandbox', 'Start a test copy of a branch (list / stop too)', 'Branch (Enter for this one, or "list" / "stop 3072"):'],
  ['test-apk', 'Build the Ember Test phone app', 'Branch (Enter for this one):'],
  ['shots', 'Screenshots of pages, phone and desktop', 'Pages (e.g. /library /settings):'],
  ['reports', 'New bug reports and requests from Discord', null],
  ['notes-draft', 'Draft the release notes from the commits', null],
  ['release', 'Make a release (bump, notes, tests, commit)', null],
  ['release:check', 'Run every test suite', null],
  ['notify', 'Send the owner a Discord message', 'Message:'],
  ['host-check', 'Does the host need ./update.sh?', null],
  ['tidy-branches', 'Delete branches already merged into main', null],
  ['hooks', 'Turn on the pre-push check (once)', null],
];

TOOLS.forEach(([name, what], i) => say(`${String(i + 1).padStart(2)}  ${name.padEnd(14)} ${what}`));
if (!interactive()) process.exit(0);

const pick = TOOLS[Number(await ask('\nNumber (Enter to quit):', { fallback: '' })) - 1];
if (!pick) process.exit(0);
const [name, , question] = pick;
const answer = question ? await ask(question, { fallback: '' }) : '';
const args = answer ? ['--', ...answer.split(/\s+/)] : [];
process.exit(sh('npm', ['run', '--silent', name, ...args], { stdio: 'inherit' }).status ?? 0);
