#!/usr/bin/env node
/** Make an Ember release from the branch you are on.
 *
 *    npm run release -- prepare notes.md            web only
 *    npm run release -- prepare notes.md --shells   web + desktop/Android/iOS
 *    npm run release -- preview                     show what would go out
 *    npm run release -- push                        push main (+ tag), asks first
 *
 *  prepare: checks the branch is clean and contains origin/main, bumps every
 *  version, writes the What's new entry and UPDATE_NOTES.md from the notes
 *  file (format in releaseLib.mjs parseNotes), runs every test suite
 *  (scripts/release/check-all.sh) and commits "chore(release): ...".
 *  Nothing leaves the Mac.
 *
 *  push: shows the commits, the What's new text and the host notes, and only
 *  after you type "push" pushes HEAD to main, plus the vX tag when the
 *  release has new shells (that tag makes GitHub build the apps). Then it
 *  can follow the build. */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
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
} from './releaseLib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const say = (s = '') => console.log(s);
function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Clean, up to date with GitHub, and nothing on main left out. */
function preflight() {
  if (git('status', '--porcelain')) fail('There are uncommitted changes. Commit or put them aside first.');
  say('Fetching origin...');
  git('fetch', '-q', 'origin');
  try {
    git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
  } catch {
    fail('This branch is missing commits that are on origin/main. Merge main into it first.');
  }
}

function prepare(args) {
  const notesPath = args.find((a) => !a.startsWith('--'));
  const withShells = args.includes('--shells');
  if (!notesPath) fail('Usage: npm run release -- prepare <notes.md> [--shells] [--skip-tests]');
  preflight();

  const notes = parseNotes(fs.readFileSync(path.resolve(process.cwd(), notesPath), 'utf8'));
  const problems = notesProblems(notes, changelogIds(read(FILES.changelog)));
  if (problems.length) fail(`The notes need fixing:\n  - ${problems.join('\n  - ')}`);

  const web = nextPatch(readWebVersion(read(FILES.webPackage)));
  write(FILES.webPackage, bumpWebPackage(read(FILES.webPackage), web));
  write(FILES.lock, bumpLock(read(FILES.lock), web));
  write(FILES.changelog, insertChangelog(read(FILES.changelog), notes, web, today()));

  let shells = null;
  let versionCode = null;
  if (withShells) {
    shells = nextPatch(readShellVersion(read(FILES.tauri)));
    versionCode = readVersionCode(read(FILES.gradle)) + 1;
    const bumped = bumpShells(
      { tauri: read(FILES.tauri), cargoToml: read(FILES.cargoToml), cargoLock: read(FILES.cargoLock), gradle: read(FILES.gradle), pbxproj: read(FILES.pbxproj) },
      shells,
      versionCode,
    );
    for (const [key, text] of Object.entries(bumped)) write(FILES[key], text);
  }
  write(FILES.updateNotes, insertUpdateNotes(read(FILES.updateNotes), { version: web, title: notes.title, shells, versionCode, host: notes.host }));
  say(`Versions: web ${web}${shells ? `, shells ${shells} (Android versionCode ${versionCode})` : ''}`);

  if (!args.includes('--skip-tests')) {
    say('Running every test suite (a few minutes)...');
    const checks = spawnSync('bash', [path.join(ROOT, 'scripts/release/check-all.sh'), ...(withShells ? ['--shells'] : [])], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (checks.status !== 0) {
      fail('Tests failed, nothing was committed. Fix them and run prepare again after `git checkout -- .`');
    }
  }

  git('add', '-A', ...Object.values(FILES));
  git('commit', '-q', '-m', commitSubject(web, shells, notes.title));
  say(`\n✓ Committed ${git('log', '--oneline', '-1')}`);
  preview();
  say('\nNothing is pushed yet. When it looks right: npm run release -- push');
}

/** What the release commit on HEAD carries. */
function releaseOnHead() {
  const subject = git('log', '-1', '--format=%s');
  const m = /^chore\(release\): web (\S+?)(?: and shells (\S+?))?, /.exec(subject);
  if (!m) fail(`HEAD is not a release commit (${subject}). Run prepare first.`);
  return { subject, web: m[1], shells: m[2] ?? null };
}

function preview() {
  const rel = releaseOnHead();
  say('\n──── Commits going to main ────');
  say(git('log', '--format=  %h %s', 'origin/main..HEAD') || '  (none)');
  say("\n──── What's new ────");
  const changelog = git('show', 'HEAD:' + FILES.changelog);
  const start = changelog.indexOf('export const CHANGELOG');
  say(changelog.slice(start, changelog.indexOf('\n  },', start) + 5).split('\n').slice(1).join('\n'));
  say('\n──── UPDATE_NOTES.md (for the host) ────');
  say(git('show', 'HEAD:UPDATE_NOTES.md').split('\n# ')[0]);
  if (rel.shells) say(`\nTag v${rel.shells} will be pushed too: GitHub then builds the desktop and Android apps.`);
}

async function push() {
  const rel = releaseOnHead();
  preflight();
  preview();
  if (!process.stdin.isTTY) fail('push asks for a typed confirmation, so run it in a terminal.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\nType "push" to send this to main, anything else stops: ')).trim();
  rl.close();
  if (answer !== 'push') fail('Stopped. Nothing was pushed.');

  git('push', 'origin', 'HEAD:main');
  say('✓ main pushed');
  if (rel.shells) {
    git('tag', `v${rel.shells}`);
    git('push', 'origin', `v${rel.shells}`);
    say(`✓ tag v${rel.shells} pushed, the app builds are starting on GitHub`);
    if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0) {
      say('Following the build (Ctrl+C stops watching, not the build)...');
      spawnSync('bash', ['-c', 'sleep 15; gh run watch "$(gh run list --workflow native-build.yml --limit 1 --json databaseId -q ".[0].databaseId")" --exit-status'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
    }
  }
  say(`\nDone: web ${rel.web}${rel.shells ? ` and apps ${rel.shells}` : ''}. The host updates with ./update.sh.`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'prepare') prepare(rest);
else if (command === 'preview') preview();
else if (command === 'push') await push();
else {
  say('Usage:');
  say('  npm run release -- prepare <notes.md> [--shells] [--skip-tests]');
  say('  npm run release -- preview');
  say('  npm run release -- push');
  process.exit(command ? 1 : 0);
}
