#!/usr/bin/env node
/** Make an Ember release from the branch you are on.
 *
 *    npm run release                  prepare, from .release-notes.md
 *    npm run release -- prepare notes.md [--os=android,windows | --shells | --no-shells]
 *    npm run release -- preview       show what would go out
 *    npm run release -- push          push main (+ app tags), asks first
 *    npm run release -- push --confirmed   no question: only after the
 *                                          owner said yes to the preview
 *
 *  Every app (android, ios, windows, macos, linux) has its own version and
 *  its own tag (android-v0.4.26). An app is included by itself when its code
 *  changed since its last tag (<os>-v*, or the last shared vX tag before
 *  those existed); see detectOses for which change counts for which app.
 *  --os=android,windows picks them by hand, --shells takes all five and
 *  --no-shells none. Without a notes file, a draft is written to
 *  .release-notes.md (npm run notes-draft) to edit first.
 *
 *  prepare: checks the branch is clean and contains origin/main, bumps the
 *  web version and each included app's, writes the What's new entry and
 *  UPDATE_NOTES.md from the notes file (format in releaseLib.mjs
 *  parseNotes), runs every test suite (scripts/release/check-all.sh) and
 *  commits "chore(release): ...". Nothing leaves the Mac.
 *
 *  push: shows the commits, the What's new text and the host notes, and only
 *  after you type "push" pushes HEAD to main, plus one tag per app the
 *  release commit bumped (each tag makes GitHub build that app). Then it can
 *  follow the build. */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
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
  parseNotes,
  parseOsList,
  readOsVersion,
  readVersionCode,
  readWebVersion,
  releaseTags,
  releaseWebVersion,
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

/** The apps whose code changed since each one's own last release: its
 *  <os>-v* tag, or the last shared vX tag from before those. */
function changedOses() {
  const lastTag = (pattern) => {
    try {
      return git('describe', '--tags', '--abbrev=0', '--match', pattern, 'origin/main');
    } catch {
      return null;
    }
  };
  return OSES.filter((os) => {
    const tag = lastTag(`${os}-v*`) ?? lastTag('v[0-9]*');
    if (!tag) return true;
    const changed = git('diff', '--name-only', tag, 'HEAD', '--', 'apps/desktop', 'apps/mobile').split('\n').filter(Boolean);
    return detectOses(changed).includes(os);
  });
}

/** Every app's version file, by FILES key. */
function readOsFiles() {
  return Object.fromEntries(OSES.map((os) => [OS_FILE[os], read(FILES[OS_FILE[os]])]));
}

function prepare(args) {
  const defaultNotes = path.join(ROOT, '.release-notes.md');
  let notesPath = args.find((a) => !a.startsWith('--'));
  if (!notesPath) {
    if (!fs.existsSync(defaultNotes)) {
      spawnSync('node', [path.join(ROOT, 'scripts/ember/notes-draft.mjs')], { cwd: ROOT, stdio: 'inherit' });
      fail('Edit .release-notes.md first, then run npm run release again.');
    }
    notesPath = defaultNotes;
  }
  const osArg = args.find((a) => a.startsWith('--os='));
  const oses = osArg
    ? parseOsList(osArg.slice('--os='.length))
    : args.includes('--shells')
      ? OSES
      : args.includes('--no-shells')
        ? []
        : changedOses();
  preflight();

  const notes = parseNotes(fs.readFileSync(path.resolve(process.cwd(), notesPath), 'utf8'));
  const problems = notesProblems(notes, changelogIds(read(FILES.changelog)));
  if (problems.length) fail(`The notes need fixing:\n  - ${problems.join('\n  - ')}`);

  const web = nextPatch(readWebVersion(read(FILES.webPackage)));
  write(FILES.webPackage, bumpWebPackage(read(FILES.webPackage), web));
  write(FILES.lock, bumpLock(read(FILES.lock), web));
  write(FILES.changelog, insertChangelog(read(FILES.changelog), notes, web, today()));

  const files = readOsFiles();
  const released = [];
  const unchanged = [];
  for (const os of OSES) {
    const current = readOsVersion(os, files);
    if (!oses.includes(os)) {
      unchanged.push({ os, version: current });
      continue;
    }
    const version = nextPatch(current);
    const versionCode = os === 'android' ? readVersionCode(files[OS_FILE.android]) + 1 : undefined;
    for (const [key, text] of Object.entries(bumpOs(os, files, version, versionCode))) write(FILES[key], text);
    released.push({ os, version, versionCode });
  }
  write(FILES.updateNotes, insertUpdateNotes(read(FILES.updateNotes), { version: web, title: notes.title, released, unchanged, host: notes.host }));
  say(`Versions: web ${web}${released.map((a) => `, ${a.os} ${a.version}${a.versionCode ? ` (versionCode ${a.versionCode})` : ''}`).join('')}`);

  if (!args.includes('--skip-tests')) {
    say('Running every test suite (a few minutes)...');
    const checks = spawnSync('bash', [path.join(ROOT, 'scripts/release/check-all.sh'), ...(released.length ? ['--shells'] : [])], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (checks.status !== 0) {
      fail('Tests failed, nothing was committed. Fix them and run prepare again after `git checkout -- .`');
    }
  }

  git('add', '-A', ...Object.values(FILES).filter((f) => fs.existsSync(path.join(ROOT, f))));
  git('commit', '-q', '-m', commitSubject(web, released, notes.title));
  say(`\n✓ Committed ${git('log', '--oneline', '-1')}`);
  preview();
  if (notesPath === defaultNotes) fs.rmSync(defaultNotes);
  say('\nNothing is pushed yet. When it looks right: npm run release -- push');
}

/** What the release commit on HEAD carries: its web version and one tag per
 *  app whose version it moves past origin/main's. */
function releaseOnHead() {
  const subject = git('log', '-1', '--format=%s');
  const web = releaseWebVersion(subject);
  if (!web) fail(`HEAD is not a release commit (${subject}). Run prepare first.`);
  const filesAt = (rev) =>
    Object.fromEntries(
      OSES.map((os) => {
        try {
          const text = execFileSync('git', ['show', `${rev}:${FILES[OS_FILE[os]]}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          return [OS_FILE[os], text];
        } catch {
          return [OS_FILE[os], null];
        }
      }),
    );
  return { subject, web, tags: releaseTags(filesAt('origin/main'), filesAt('HEAD')) };
}

function preview() {
  const rel = releaseOnHead();
  say('\n──── Commits going to main ────');
  const commits = git('log', '--format=%h %s', 'origin/main..HEAD');
  say(commits ? commits.split('\n').map((l) => `  ${l}`).join('\n') : '  (none)');
  say("\n──── What's new ────");
  const changelog = git('show', 'HEAD:' + FILES.changelog);
  const start = changelog.indexOf('export const CHANGELOG');
  say(changelog.slice(start, changelog.indexOf('\n  },', start) + 5).split('\n').slice(1).join('\n'));
  say('\n──── UPDATE_NOTES.md (for the host) ────');
  say(git('show', 'HEAD:UPDATE_NOTES.md').split('\n# ')[0]);
  if (rel.tags.length) say(`\nTags pushed too, each builds its app on GitHub: ${rel.tags.join(' ')}`);
}

async function push(confirmed) {
  const rel = releaseOnHead();
  preflight();
  preview();
  if (!confirmed) {
    if (!process.stdin.isTTY) fail('Show this preview to the owner; after his yes: npm run release -- push --confirmed');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nType "push" to send this to main, anything else stops: ')).trim();
    rl.close();
    if (answer !== 'push') fail('Stopped. Nothing was pushed.');
  }

  git('push', 'origin', 'HEAD:main');
  say('✓ main pushed');
  // Put the version on what the tracker lists as fixed or made. Never fails a release.
  try {
    spawnSync('node', [path.join(ROOT, 'scripts/ember/tracker.mjs'), 'release', rel.web], { cwd: ROOT, stdio: 'inherit', timeout: 60000 });
  } catch {
    say('(tracker not updated)');
  }
  if (rel.tags.length) {
    // One push per tag: GitHub starts no workflow at all for the tags of a
    // push that carries more than three.
    for (const tag of rel.tags) {
      git('tag', tag);
      git('push', 'origin', tag);
    }
    say(`✓ tags ${rel.tags.join(' ')} pushed, the app builds are starting on GitHub`);
    if (confirmed) say('Follow the app build with: gh run watch');
    else if (spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0) {
      say('Following the build (Ctrl+C stops watching, not the build)...');
      spawnSync('bash', ['-c', 'sleep 15; gh run watch "$(gh run list --workflow native-build.yml --limit 1 --json databaseId -q ".[0].databaseId")" --exit-status'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
    }
  }
  say(`\nDone: web ${rel.web}${rel.tags.length ? ` and ${rel.tags.join(', ')}` : ''}. The host updates with ./update.sh.`);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command.startsWith('--')) prepare(process.argv.slice(2));
else if (command === 'prepare') prepare(rest);
else if (command === 'preview') preview();
else if (command === 'push') await push(rest.includes('--confirmed'));
else {
  say('Usage:');
  say('  npm run release                    (uses .release-notes.md)');
  say('  npm run release -- prepare <notes.md> [--os=android,windows | --shells | --no-shells] [--skip-tests]');
  say('  npm run release -- preview');
  say('  npm run release -- push [--confirmed]');
  process.exit(1);
}
