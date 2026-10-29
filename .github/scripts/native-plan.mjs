// What a native-build run builds, from the ref that started it. The `plan`
// job of .github/workflows/native-build.yml runs this and hands its outputs
// to the other jobs. Node 20 built-ins only.
//
//   <os>-vX.Y.Z (android, ios, windows, macos, linux)  that app only
//   vX.Y.Z (the tags from before per-app versions)    every app
//   a branch push or a manual run                     as before: Windows and
//                                                     Linux, Android, iOS
//
// A tag whose version is not the one in that app's version file fails here,
// before anything is built: the binary takes its version from that file
// (iOS takes it from the tag, see the ios job), so a mismatch would publish
// an app that reports another version than its release.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_OSES, FILES, OSES, OS_FILE, OS_LABEL, readOsVersion } from '../../scripts/release/releaseLib.mjs';

/** The GitHub runner each desktop OS builds on. */
export const RUNNER = { windows: 'windows-latest', macos: 'macos-latest', linux: 'ubuntu-latest' };
/** Branch pushes: macOS is left out at 10x the minutes (built on the Mac). */
const BRANCH_DESKTOP = ['windows-latest', 'ubuntu-latest'];

/** "windows-v0.4.26" -> { os: 'windows', version: '0.4.26' }, "v0.4.25" ->
 *  { os: null, ... }, anything else null. */
export function parseTag(name) {
  const m = /^(?:(android|ios|windows|macos|linux)-)?v(\d+\.\d+\.\d+)$/.exec(name ?? '');
  return m ? { os: m[1] ?? null, version: m[2] } : null;
}

/** The run's plan: { version, desktop_matrix (JSON list of runners),
 *  android, ios ('true'/'false'), title (the GitHub release's) }. Throws
 *  when the tag is not a release tag or does not match the version files
 *  (`files`: FILES keys to their text). */
export function planBuild({ refType, refName, files }) {
  if (refType !== 'tag') {
    return { version: '', desktop_matrix: JSON.stringify(BRANCH_DESKTOP), android: 'true', ios: 'true', title: '' };
  }
  const tag = parseTag(refName);
  if (!tag) throw new Error(`${refName} is not a release tag (vX.Y.Z or <os>-vX.Y.Z)`);
  const builds = tag.os ? [tag.os] : OSES;
  // iOS gets the tag's version at build time; on an ios- tag its file must
  // still agree, so the next release counts on from the right number.
  const checked = tag.os ? [tag.os] : builds.filter((os) => os !== 'ios');
  const wrong = checked
    .map((os) => {
      let found;
      try {
        found = readOsVersion(os, files);
      } catch (e) {
        found = `unreadable (${e.message})`;
      }
      return { os, found };
    })
    .filter((x) => x.found !== tag.version);
  if (wrong.length) {
    throw new Error(
      `Tag ${refName} does not match the app version: ${wrong.map((x) => `${x.os} is ${x.found} in ${FILES[OS_FILE[x.os]]}`).join('; ')}`,
    );
  }
  return {
    version: tag.version,
    desktop_matrix: JSON.stringify(DESKTOP_OSES.filter((os) => builds.includes(os)).map((os) => RUNNER[os])),
    android: String(builds.includes('android')),
    ios: String(builds.includes('ios')),
    title: tag.os ? `Ember ${OS_LABEL[tag.os]} ${tag.version}` : `Ember ${refName}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = {};
  for (const os of OSES) {
    const rel = FILES[OS_FILE[os]];
    try {
      files[OS_FILE[os]] = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      // planBuild names it if this run needs it.
    }
  }
  try {
    const plan = planBuild({ refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME, files });
    const lines = Object.entries(plan).map(([k, v]) => `${k}=${v}`);
    console.log(lines.join('\n'));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
