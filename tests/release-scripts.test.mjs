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
  DESKTOP_OS_ONLY_FILES,
  FILES,
  OSES,
  OS_FILE,
  bumpLock,
  bumpOs,
  bumpWebPackage,
  changelogIds,
  commitSubject,
  detectOses,
  insertChangelog,
  insertUpdateNotes,
  nextPatch,
  notesProblems,
  osTag,
  parseNotes,
  parseOsList,
  readOsVersion,
  readVersionCode,
  readWebVersion,
  releaseTags,
  releaseWebVersion,
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

const osFiles = () => Object.fromEntries(OSES.map((os) => [OS_FILE[os], read(FILES[OS_FILE[os]])]));

test('every app has a readable version of its own', () => {
  const files = osFiles();
  for (const os of OSES) assert.match(readOsVersion(os, files), /^\d+\.\d+\.\d+$/, os);
  // The shared Tauri config has none: each desktop OS has its own file.
  assert.equal(JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')).version, undefined);
  assert.throws(() => readOsVersion('web', files), /Unknown app/);
});

test('bumpOs moves only that app, Android with its versionCode', () => {
  const files = osFiles();
  for (const os of OSES) {
    const next = nextPatch(readOsVersion(os, files));
    const code = readVersionCode(files.gradle) + 1;
    const out = bumpOs(os, files, next, os === 'android' ? code : undefined);
    assert.deepEqual(Object.keys(out), [OS_FILE[os]], os);
    const after = { ...files, ...out };
    assert.equal(readOsVersion(os, after), next, os);
    for (const other of OSES.filter((o) => o !== os)) assert.equal(readOsVersion(other, after), readOsVersion(other, files), `${os} moved ${other}`);
    if (os === 'android') assert.equal(readVersionCode(out.gradle), code);
    else assert.equal(readVersionCode(after.gradle), readVersionCode(files.gradle), `${os} moved the versionCode`);
  }
  // Both Xcode configurations move together.
  const ios = bumpOs('ios', files, '9.9.9').pbxproj;
  const marketing = [...ios.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(marketing.length >= 2 && marketing.every((m) => m === '9.9.9'));
  // A desktop OS's file keeps its exact layout, version aside.
  const win = bumpOs('windows', files, '9.9.9').tauriWindows;
  assert.equal(win, files.tauriWindows.replace(/"version": "[^"]+"/, '"version": "9.9.9"'));
  assert.throws(() => bumpOs('android', files, '9.9.9'), /versionCode/);
});

test('detectOses: each change releases the apps it touches', () => {
  assert.deepEqual(detectOses([]), []);
  assert.deepEqual(detectOses(['apps/mobile/android/app/src/main/java/app/ember/music/MainActivity.kt']), ['android']);
  assert.deepEqual(detectOses(['apps/mobile/ios/App/App/AppDelegate.swift']), ['ios']);
  assert.deepEqual(detectOses(['apps/mobile/capacitor.config.ts']), ['android', 'ios']);
  assert.deepEqual(detectOses(['apps/desktop/src-tauri/src/lib.rs']), ['windows', 'macos', 'linux']);
  assert.deepEqual(detectOses(['apps/desktop/src-tauri/src/speech/windows.rs']), ['windows']);
  assert.deepEqual(detectOses(['apps/desktop/src-tauri/src/speech/windows.rs', 'apps/desktop/src-tauri/src/speech/macos.rs']), ['windows', 'macos']);
  // One cfg-only file next to shared code is still every desktop OS.
  assert.deepEqual(detectOses(['apps/desktop/src-tauri/src/speech/macos.rs', 'apps/desktop/src-tauri/Cargo.toml']), ['windows', 'macos', 'linux']);
  // Another OS's release (its version file) does not make this one due.
  assert.deepEqual(detectOses(['apps/desktop/src-tauri/tauri.windows.conf.json', 'apps/mobile/android/app/build.gradle']), ['android', 'windows']);
  assert.deepEqual(detectOses(['apps/web/lib/x.ts', 'docs/APPS.md']), []);
  // A custom list, as the caller passes it.
  assert.deepEqual(detectOses(['apps/desktop/x.rs'], { 'apps/desktop/x.rs': 'linux' }), ['linux']);
  // Every OS-only file named really exists, so a rename cannot silently
  // turn it into "all three".
  for (const p of Object.keys(DESKTOP_OS_ONLY_FILES)) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
});

test('--os= picks apps by hand, in the usual order', () => {
  assert.deepEqual(parseOsList('windows,android'), ['android', 'windows']);
  assert.deepEqual(parseOsList(' Linux , '), ['linux']);
  assert.throws(() => parseOsList('android,web'), /Unknown app/);
});

test('the tags are one per app whose version moved, never a bare vX', () => {
  const before = osFiles();
  const after = { ...before };
  Object.assign(after, bumpOs('android', after, '0.9.1', 99), bumpOs('windows', after, '0.9.2'));
  assert.deepEqual(releaseTags(before, after), ['android-v0.9.1', 'windows-v0.9.2']);
  assert.deepEqual(releaseTags(before, before), []);
  // A version file origin/main does not have yet counts as new.
  assert.deepEqual(releaseTags({ ...before, tauriLinux: null }, before), [osTag('linux', readOsVersion('linux', before))]);
  assert.equal(osTag('macos', '0.4.25'), 'macos-v0.4.25');
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

test('UPDATE_NOTES gets the host block on top, naming each app version and tag', () => {
  const web = insertUpdateNotes('# 0.7.30: Old\n', { version: '0.7.31', title: 'Add to queue' });
  assert.match(web, /^# 0\.7\.31: Add to queue\n\n\*\*Host: run `\.\/update\.sh`/);
  assert.doesNotMatch(web.split('# 0.7.30')[0], /tag/i);
  const apps = insertUpdateNotes('', {
    version: '0.7.31',
    title: 'X',
    released: [
      { os: 'android', version: '0.4.25', versionCode: 30 },
      { os: 'windows', version: '0.4.25' },
      { os: 'macos', version: '0.4.26' },
    ],
    unchanged: [
      { os: 'ios', version: '0.4.24' },
      { os: 'linux', version: '0.4.25' },
    ],
    host: 'Restart PocketBase too.',
  });
  assert.match(apps, /^# 0\.7\.31: X \(android, windows 0\.4\.25, macos 0\.4\.26\)/);
  const flat = apps.replace(/\n/g, ' ');
  assert.match(flat, /Restart PocketBase too\. New apps: Android 0\.4\.25 \(versionCode 30\), Windows 0\.4\.25, macOS 0\.4\.26\./);
  assert.match(flat, /Unchanged: iOS 0\.4\.24, Linux 0\.4\.25\./);
  assert.match(flat, /Tags: `android-v0\.4\.25`, `windows-v0\.4\.25`, `macos-v0\.4\.26`\./);
  assert.doesNotMatch(flat, /`v0\.4/);
  assert.ok(apps.split('\n').every((l) => l.length <= 78));
});

test('the commit subject matches the house style, and push reads its web version back', () => {
  assert.equal(commitSubject('0.7.31', [], 'Add to queue'), 'chore(release): web 0.7.31, add to queue');
  const subject = commitSubject('0.7.31', [{ os: 'android', version: '0.4.25' }, { os: 'linux', version: '0.4.25' }], 'Keeps playing');
  assert.equal(subject, 'chore(release): web 0.7.31 and apps (android, linux 0.4.25), keeps playing');
  assert.equal(releaseWebVersion(subject), '0.7.31');
  assert.equal(releaseWebVersion('chore(release): web 0.7.31 and shells 0.4.25, safer and smoother'), '0.7.31');
  assert.equal(releaseWebVersion('chore(release): web 0.7.31, add to queue'), '0.7.31');
  assert.equal(releaseWebVersion('fix: something'), null);
});
