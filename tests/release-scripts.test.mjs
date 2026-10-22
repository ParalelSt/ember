/** The release script's text edits, run against the repo's real files (read
 *  only), so a file whose layout changes breaks this test instead of a
 *  release.
 *
 *      node tests/release-scripts.test.mjs      # or: npm run test:release-scripts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FILES,
  bumpLock,
  bumpShells,
  bumpWebPackage,
  changelogIds,
  commitSubject,
  insertChangelog,
  insertUpdateNotes,
  nextPatch,
  notesProblems,
  parseNotes,
  readShellVersion,
  readVersionCode,
  readWebVersion,
} from '../scripts/release/releaseLib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOTES = `# a comment
id: add-to-queue
title: Add to queue
summary: Put a song next in line from any list.
- The ... menu on a song now has Add to queue.
- It's played after the songs you already queued.
host: Nothing else to do.
`;

test('nextPatch counts up the last number only', () => {
  assert.equal(nextPatch('0.7.30'), '0.7.31');
  assert.equal(nextPatch('1.9.9'), '1.9.10');
  assert.throws(() => nextPatch('0.7'));
});

test('the web version moves in package.json and package-lock.json, nowhere else', () => {
  const v = readWebVersion(read(FILES.webPackage));
  const next = nextPatch(v);
  assert.equal(readWebVersion(bumpWebPackage(read(FILES.webPackage), next)), next);
  const before = read(FILES.lock).split('\n');
  const lock = bumpLock(before.join('\n'), next);
  assert.match(lock, new RegExp(`"apps/web": \\{\\n\\s+"version": "${next.replace(/\./g, '\\.')}"`));
  const changed = lock.split('\n').filter((l, i) => l !== before[i]);
  assert.equal(changed.length, 1);
});

test('every shell file moves to the same version, versionCode up by one', () => {
  const files = Object.fromEntries(['tauri', 'cargoToml', 'cargoLock', 'gradle', 'pbxproj'].map((k) => [k, read(FILES[k])]));
  const next = nextPatch(readShellVersion(files.tauri));
  const code = readVersionCode(files.gradle) + 1;
  const out = bumpShells(files, next, code);
  assert.equal(readShellVersion(out.tauri), next);
  assert.match(out.cargoToml, new RegExp(`^version = "${next}"`, 'm'));
  assert.match(out.cargoLock, new RegExp(`name = "ember-desktop"\\nversion = "${next}"`));
  assert.equal(readVersionCode(out.gradle), code);
  assert.match(out.gradle, new RegExp(`versionName "${next}"`));
  const marketing = [...out.pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(marketing.length >= 2);
  assert.ok(marketing.every((m) => m === next));
});

test('notes are read from the simple file format', () => {
  const notes = parseNotes(NOTES);
  assert.equal(notes.id, 'add-to-queue');
  assert.equal(notes.title, 'Add to queue');
  assert.equal(notes.bullets.length, 2);
  assert.equal(notes.host, 'Nothing else to do.');
  assert.throws(() => parseNotes('this line means nothing'));
});

test('notes that break the house rules are refused, each with the reason', () => {
  const ids = changelogIds(read(FILES.changelog));
  assert.ok(ids.length > 10);
  assert.deepEqual(notesProblems(parseNotes(NOTES), ids), []);
  const bad = parseNotes(`id: ${ids[0]}\ntitle: New \u2014 thing\nsummary: A prank for you.\n`);
  const problems = notesProblems(bad, ids).join(' | ');
  assert.match(problems, /already in the changelog/);
  assert.match(problems, /em dashes/);
  assert.match(problems, /pranks/);
  assert.match(problems, /bullet/);
});

test('the What\'s new entry goes on top, quotes escaped, and stays valid TypeScript-ish', () => {
  const text = insertChangelog(read(FILES.changelog), parseNotes(NOTES), '0.9.0', '2026-10-22');
  assert.equal(changelogIds(text)[0], 'add-to-queue');
  assert.match(text, /version: '0\.9\.0',\n {4}date: '2026-10-22',/);
  assert.ok(text.includes("'It\\'s played after the songs you already queued.',"));
});

test('UPDATE_NOTES gets the host block on top, naming the tag only with shells', () => {
  const web = insertUpdateNotes('# 0.7.30: Old\n', { version: '0.7.31', title: 'Add to queue' });
  assert.match(web, /^# 0\.7\.31: Add to queue\n\n\*\*Host: run `\.\/update\.sh`/);
  assert.doesNotMatch(web.split('# 0.7.30')[0], /tag/);
  const both = insertUpdateNotes('', { version: '0.7.31', title: 'X', shells: '0.4.25', versionCode: 30, host: 'Restart PocketBase too.' });
  assert.match(both, /^# 0\.7\.31: X \(apps 0\.4\.25\)/);
  assert.match(both.replace(/\n/g, ' '), /Restart PocketBase too\. The apps are 0\.4\.25 \(Android versionCode 30\), which the `v0\.4\.25` tag builds\./);
  assert.ok(both.split('\n').every((l) => l.length <= 78));
});

test('the commit subject matches the house style', () => {
  assert.equal(commitSubject('0.7.31', null, 'Add to queue'), 'chore(release): web 0.7.31, add to queue');
  assert.equal(
    commitSubject('0.7.31', '0.4.25', 'Keeps playing'),
    'chore(release): web 0.7.31 and shells 0.4.25, keeps playing',
  );
});
