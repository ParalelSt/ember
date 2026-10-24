#!/usr/bin/env node
/** npm run notes-draft
 *
 *  Writes .release-notes.md (git ignores it) from the commits this branch has
 *  that main does not: an id and title from the branch name, one bullet per
 *  fix or feature. Edit the wording, then `npm run release`. Keeps an
 *  existing file unless --force. */

import fs from 'node:fs';
import path from 'node:path';
import { draftNotes } from './logic.mjs';
import { ROOT, fail, git, parseArgs, say } from './lib.mjs';

export const NOTES_FILE = path.join(ROOT, '.release-notes.md');

const { flags } = parseArgs(process.argv.slice(2));
if (fs.existsSync(NOTES_FILE) && !flags.force) fail(`${NOTES_FILE} already exists (add --force to write a new one).`);

git(['fetch', '-q', 'origin']);
const subjects = git(['log', '--no-merges', '--format=%s', 'origin/main..HEAD']).split('\n').filter(Boolean).reverse();
const notes = draftNotes(git(['rev-parse', '--abbrev-ref', 'HEAD']), subjects);
fs.writeFileSync(NOTES_FILE, notes);
say(notes);
say(`✓ ${NOTES_FILE}  Edit it, then: npm run release`);
