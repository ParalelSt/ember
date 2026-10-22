/** The parts of a release that are plain text edits, kept pure so
 *  tests/release-scripts.test.mjs can check them without touching the repo.
 *  scripts/release/release.mjs does the reading, writing and git. */

/** Every file that carries a version, relative to the repo root. */
export const FILES = {
  webPackage: 'apps/web/package.json',
  lock: 'package-lock.json',
  changelog: 'apps/web/lib/changelog.ts',
  updateNotes: 'UPDATE_NOTES.md',
  tauri: 'apps/desktop/src-tauri/tauri.conf.json',
  cargoToml: 'apps/desktop/src-tauri/Cargo.toml',
  cargoLock: 'apps/desktop/src-tauri/Cargo.lock',
  gradle: 'apps/mobile/android/app/build.gradle',
  pbxproj: 'apps/mobile/ios/App/App.xcodeproj/project.pbxproj',
};

/** "0.7.30" -> "0.7.31". */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Not a plain x.y.z version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Replace exactly one match of `re` (its first group is the old value), or
 *  throw, so a file whose layout changed fails loudly instead of silently
 *  keeping the old number. */
function replaceOne(text, re, value, what) {
  const hits = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (hits.length !== 1) throw new Error(`Expected one ${what}, found ${hits.length}`);
  return text.replace(re, (whole, old) => whole.replace(old, value));
}

export function readWebVersion(pkgText) {
  return JSON.parse(pkgText).version;
}

export function bumpWebPackage(text, v) {
  return replaceOne(text, /^ {2}"version": "([^"]+)"/m, v, 'version in apps/web/package.json');
}

export function bumpLock(text, v) {
  return replaceOne(text, /"apps\/web": \{\n\s+"version": "([^"]+)"/, v, '"apps/web" version in package-lock.json');
}

export function readShellVersion(tauriText) {
  return JSON.parse(tauriText).version;
}

export function readVersionCode(gradleText) {
  const m = /versionCode (\d+)/.exec(gradleText);
  if (!m) throw new Error('No versionCode in build.gradle');
  return Number(m[1]);
}

/** Every shell file at version `v`, Android versionCode `code`. */
export function bumpShells(files, v, code) {
  return {
    tauri: replaceOne(files.tauri, /^ {2}"version": "([^"]+)"/m, v, 'version in tauri.conf.json'),
    cargoToml: replaceOne(files.cargoToml, /^version = "([^"]+)"/m, v, 'package version in Cargo.toml'),
    cargoLock: replaceOne(files.cargoLock, /name = "ember-desktop"\nversion = "([^"]+)"/, v, 'ember-desktop in Cargo.lock'),
    gradle: replaceOne(
      replaceOne(files.gradle, /versionCode (\d+)/, String(code), 'versionCode'),
      /versionName "([^"]+)"/,
      v,
      'versionName',
    ),
    // Debug and release configurations each carry one.
    pbxproj: files.pbxproj.replace(/MARKETING_VERSION = ([^;]+);/g, `MARKETING_VERSION = ${v};`),
  };
}

/** Reads the notes file the release is made from:
 *
 *    id: add-to-queue
 *    title: Add to queue
 *    summary: One line for the Home banner.
 *    - A bullet for the What's new page.
 *    - Another bullet.
 *    host: Optional extra sentence for the host in UPDATE_NOTES.md.
 *
 *  Blank lines and lines starting with # are ignored. */
export function parseNotes(text) {
  const notes = { bullets: [] };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('- ')) {
      notes.bullets.push(line.slice(2).trim());
      continue;
    }
    const m = /^(id|title|summary|host):\s*(.*)$/i.exec(line);
    if (!m) throw new Error(`Notes: cannot read this line: ${line}`);
    notes[m[1].toLowerCase()] = m[2].trim();
  }
  return notes;
}

const EM_DASH = '—';
// The owner never wants pranks named in What's new (they are surprises).
const SECRET_WORDS = /\bpranks?\b|\bjoke\b/i;

/** Every reason these notes cannot ship, or an empty list. */
export function notesProblems(notes, existingIds = []) {
  const problems = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(notes.id ?? '')) problems.push('id: lowercase words joined by dashes, e.g. add-to-queue');
  if (existingIds.includes(notes.id)) problems.push(`id "${notes.id}" is already in the changelog`);
  if (!notes.title) problems.push('title is missing');
  if (!notes.summary) problems.push('summary is missing');
  if (!notes.bullets?.length) problems.push('at least one "- bullet" is needed');
  const all = [notes.title, notes.summary, notes.host, ...(notes.bullets ?? [])].filter(Boolean).join('\n');
  if (all.includes(EM_DASH)) problems.push('no em dashes, use a comma, colon or full stop');
  if (SECRET_WORDS.test(all)) problems.push('pranks stay a surprise: do not mention them in What\'s new');
  return problems;
}

/** The ids already in changelog.ts. */
export function changelogIds(changelogText) {
  return [...changelogText.matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1]);
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** changelog.ts with the new entry on top. */
export function insertChangelog(text, notes, version, date) {
  const anchor = 'export const CHANGELOG: ChangelogEntry[] = [\n';
  if (!text.includes(anchor)) throw new Error('changelog.ts: cannot find the CHANGELOG array');
  const entry = [
    '  {',
    `    id: ${quote(notes.id)},`,
    `    version: ${quote(version)},`,
    `    date: ${quote(date)},`,
    `    title: ${quote(notes.title)},`,
    `    summary: ${quote(notes.summary)},`,
    '    bullets: [',
    ...notes.bullets.map((b) => `      ${quote(b)},`),
    '    ],',
    '  },',
    '',
  ].join('\n');
  return text.replace(anchor, anchor + entry);
}

/** Wrap a paragraph at 78 columns, the width UPDATE_NOTES.md uses. */
function wrap(text, width = 78) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** UPDATE_NOTES.md with this release's block on top. */
export function insertUpdateNotes(text, { version, title, shells, versionCode, host }) {
  const heading = `# ${version}: ${title}${shells ? ` (apps ${shells})` : ''}`;
  let body = '**Host: run `./update.sh` as usual (no new packages, nothing new in `.env.local`).**';
  if (host) body += ` ${host}`;
  if (shells) body += ` The apps are ${shells} (Android versionCode ${versionCode}), which the \`v${shells}\` tag builds.`;
  return `${heading}\n\n${wrap(body)}\n\n${text}`;
}

/** The release commit's subject. */
export function commitSubject(version, shells, title) {
  const what = shells ? `web ${version} and shells ${shells}` : `web ${version}`;
  return `chore(release): ${what}, ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}
