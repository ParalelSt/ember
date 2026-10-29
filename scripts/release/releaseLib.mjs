/** The parts of a release that are plain text edits, kept pure so
 *  tests/release-scripts.test.mjs can check them without touching the repo.
 *  scripts/release/release.mjs does the reading, writing and git. */

/** Every file a release writes, relative to the repo root. Each app has its
 *  own version: Android in build.gradle, iOS in the Xcode project, and
 *  Windows, macOS and Linux each in their tauri.<os>.conf.json (Tauri merges
 *  it over tauri.conf.json, which has none). Cargo.toml's version is not
 *  read by anything and is no longer bumped. */
export const FILES = {
  webPackage: 'apps/web/package.json',
  lock: 'package-lock.json',
  changelog: 'apps/web/lib/changelog.ts',
  updateNotes: 'UPDATE_NOTES.md',
  tauriWindows: 'apps/desktop/src-tauri/tauri.windows.conf.json',
  tauriMacos: 'apps/desktop/src-tauri/tauri.macos.conf.json',
  tauriLinux: 'apps/desktop/src-tauri/tauri.linux.conf.json',
  gradle: 'apps/mobile/android/app/build.gradle',
  pbxproj: 'apps/mobile/ios/App/App.xcodeproj/project.pbxproj',
};

/** The apps, each released on its own with a <os>-vX.Y.Z tag. */
export const OSES = ['android', 'ios', 'windows', 'macos', 'linux'];
export const DESKTOP_OSES = ['windows', 'macos', 'linux'];
export const OS_LABEL = { android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux' };
/** Which FILES entry holds each app's version. */
export const OS_FILE = { android: 'gradle', ios: 'pbxproj', windows: 'tauriWindows', macos: 'tauriMacos', linux: 'tauriLinux' };

/** Desktop files that only one OS builds (cfg(target_os) code, and each OS's
 *  own version file): a change to these alone releases that OS only. Any
 *  other change under apps/desktop releases all three. */
export const DESKTOP_OS_ONLY_FILES = {
  'apps/desktop/src-tauri/src/speech/windows.rs': 'windows',
  'apps/desktop/src-tauri/src/speech/macos.rs': 'macos',
  'apps/desktop/src-tauri/tauri.windows.conf.json': 'windows',
  'apps/desktop/src-tauri/tauri.macos.conf.json': 'macos',
  'apps/desktop/src-tauri/tauri.linux.conf.json': 'linux',
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

export function readVersionCode(gradleText) {
  const m = /versionCode (\d+)/.exec(gradleText);
  if (!m) throw new Error('No versionCode in build.gradle');
  return Number(m[1]);
}

function checkOs(os) {
  if (!OSES.includes(os)) throw new Error(`Unknown app: ${os} (one of ${OSES.join(', ')})`);
}

/** The version of one app, from `files` (FILES keys to their text). */
export function readOsVersion(os, files) {
  checkOs(os);
  const text = files[OS_FILE[os]];
  if (text == null) throw new Error(`${FILES[OS_FILE[os]]} was not read`);
  if (os === 'android') {
    const m = /versionName "([^"]+)"/.exec(text);
    if (!m) throw new Error('No versionName in build.gradle');
    return m[1];
  }
  if (os === 'ios') {
    // Debug and release configurations each carry one; they must agree.
    const all = [...new Set([...text.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]))];
    if (all.length !== 1) throw new Error(`Expected one MARKETING_VERSION in the Xcode project, found ${all.join(', ') || 'none'}`);
    return all[0];
  }
  const v = JSON.parse(text).version;
  if (typeof v !== 'string') throw new Error(`No version in ${FILES[OS_FILE[os]]}`);
  return v;
}

/** One app's version file at version `v` (Android also takes its
 *  versionCode, which only moves on an Android release). Returns
 *  { <FILES key>: new text }. */
export function bumpOs(os, files, v, versionCode) {
  checkOs(os);
  const key = OS_FILE[os];
  const text = files[key];
  if (os === 'android') {
    if (!Number.isInteger(versionCode)) throw new Error('An Android release needs its versionCode');
    return {
      [key]: replaceOne(
        replaceOne(text, /versionCode (\d+)/, String(versionCode), 'versionCode'),
        /versionName "([^"]+)"/,
        v,
        'versionName',
      ),
    };
  }
  if (os === 'ios') {
    if (!/MARKETING_VERSION = /.test(text)) throw new Error('No MARKETING_VERSION in the Xcode project');
    return { [key]: text.replace(/MARKETING_VERSION = ([^;]+);/g, `MARKETING_VERSION = ${v};`) };
  }
  return { [key]: replaceOne(text, /^ {2}"version": "([^"]+)"/m, v, `version in ${FILES[key]}`) };
}

/** Which apps a change touches, from the changed paths. apps/mobile/android
 *  is Android, apps/mobile/ios is iOS, the rest of apps/mobile (Capacitor's
 *  config, its plugins) both. Under apps/desktop, files only one OS builds
 *  (`osOnlyFiles`) release that OS; anything else releases all three. */
export function detectOses(changedPaths, osOnlyFiles = DESKTOP_OS_ONLY_FILES) {
  const found = new Set();
  let wholeDesktop = false;
  for (const p of changedPaths) {
    if (p.startsWith('apps/mobile/android/')) found.add('android');
    else if (p.startsWith('apps/mobile/ios/')) found.add('ios');
    else if (p.startsWith('apps/mobile/')) {
      found.add('android');
      found.add('ios');
    } else if (p.startsWith('apps/desktop/')) {
      if (osOnlyFiles[p]) found.add(osOnlyFiles[p]);
      else wholeDesktop = true;
    }
  }
  if (wholeDesktop) for (const os of DESKTOP_OSES) found.add(os);
  return OSES.filter((os) => found.has(os));
}

/** "--os=android,windows" -> ['android', 'windows'] (in the usual order). */
export function parseOsList(text) {
  const list = text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const os of list) checkOs(os);
  return OSES.filter((os) => list.includes(os));
}

/** The tag that builds an app: android-v0.4.26. */
export function osTag(os, version) {
  checkOs(os);
  return `${os}-v${version}`;
}

/** The tags a release pushes: one per app whose version differs between
 *  `before` (origin/main) and `after` (the release), both FILES keys to
 *  their text. An app with no readable version before (its file is new)
 *  counts as changed. */
export function releaseTags(before, after) {
  const versionIn = (os, files) => {
    try {
      return readOsVersion(os, files);
    } catch {
      return null;
    }
  };
  return OSES.filter((os) => versionIn(os, after) !== versionIn(os, before)).map((os) => osTag(os, readOsVersion(os, after)));
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

const EM_DASH = '\u2014';
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

/** "android, windows 0.4.26, ios 0.4.25": the released apps, those on the
 *  same version together. `released` is [{ os, version }]. */
export function appsSummary(released) {
  const byVersion = new Map();
  for (const { os, version } of released) byVersion.set(version, [...(byVersion.get(version) ?? []), os]);
  return [...byVersion].map(([v, oses]) => `${oses.join(', ')} ${v}`).join(', ');
}

/** UPDATE_NOTES.md with this release's block on top. `released` lists the
 *  apps this release builds ([{ os, version, versionCode? }]); `unchanged`
 *  the others ([{ os, version }]), so the block names every app's version
 *  and the tags to push. */
export function insertUpdateNotes(text, { version, title, released = [], unchanged = [], host }) {
  const heading = `# ${version}: ${title}${released.length ? ` (${appsSummary(released)})` : ''}`;
  let body = '**Host: run `./update.sh` as usual (no new packages, nothing new in `.env.local`).**';
  if (host) body += ` ${host}`;
  if (released.length) {
    const apps = released.map((a) => `${OS_LABEL[a.os]} ${a.version}${a.os === 'android' ? ` (versionCode ${a.versionCode})` : ''}`);
    body += ` New apps: ${apps.join(', ')}.`;
    if (unchanged.length) body += ` Unchanged: ${unchanged.map((a) => `${OS_LABEL[a.os]} ${a.version}`).join(', ')}.`;
    body += ` Tags: ${released.map((a) => `\`${osTag(a.os, a.version)}\``).join(', ')}.`;
  }
  return `${heading}\n\n${wrap(body)}\n\n${text}`;
}

/** The release commit's subject. `released` as for insertUpdateNotes. */
export function commitSubject(version, released, title) {
  const what = released?.length ? `web ${version} and apps (${appsSummary(released)})` : `web ${version}`;
  return `chore(release): ${what}, ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

/** The web version of a release commit's subject, or null when it is not
 *  one. Reads the subjects from before per-app versions too. */
export function releaseWebVersion(subject) {
  const m = /^chore\(release\): web (\d+\.\d+\.\d+)\b/.exec(subject);
  return m ? m[1] : null;
}
