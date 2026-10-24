/** The native-build workflow with per-app tags (android-v0.4.25,
 *  windows-v0.4.25, ...): which jobs each tag runs, that the release job
 *  survives the jobs a tag skips but not a failed one, and that the plan
 *  stops a tag whose version is not the app's. Reads the real workflow file
 *  and version files; runs nothing on GitHub.
 *
 *      node tests/native-build-workflow.test.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseTag, planBuild } from '../.github/scripts/native-plan.mjs';
import { FILES, OSES, OS_FILE, bumpOs, readOsVersion } from '../scripts/release/releaseLib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(ROOT, '.github/workflows/native-build.yml');
const wf = yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));
const jobs = wf.jobs;

/** Every app's version file, as the plan job reads them. */
const files = Object.fromEntries(OSES.map((o) => [OS_FILE[o], fs.readFileSync(path.join(ROOT, FILES[OS_FILE[o]]), 'utf8')]));
/** The version files with every app at `v` (Android's versionCode aside). */
function filesAt(v) {
  let out = { ...files };
  for (const o of OSES) out = { ...out, ...bumpOs(o, out, v, o === 'android' ? 1 : undefined) };
  return out;
}

/** GitHub's expression language, as far as these `if:`s use it: `==`,
 *  `!=`, `&&`, `||`, `!`, strings, always(), success(), startsWith() and
 *  contains(needs.*.result, ...). Like GitHub, an `if:` without a status
 *  function only runs when every needed job succeeded (a skipped one
 *  included, which is what used to skip the release). */
function evaluate(expr, ctx) {
  const bare = expr.replace(/\$\{\{|\}\}/g, '');
  const withStatus = /\b(always|success|failure|cancelled)\(\)/.test(bare) ? bare : `success() && (${bare})`;
  const js = withStatus
    .replace(/\bsuccess\(\)/g, String(Object.values(ctx.results).every((r) => r === 'success')))
    .replace(/\balways\(\)/g, 'true')
    .replace(/contains\(needs\.\*\.result,\s*'(\w+)'\)/g, (_, r) => String(Object.values(ctx.results).includes(r)))
    .replace(/startsWith\(github\.ref,\s*'([^']*)'\)/g, (_, p) => String(ctx.ref.startsWith(p)))
    .replace(/needs\.plan\.outputs\.(\w+)/g, (_, k) => JSON.stringify(ctx.plan[k] ?? ''))
    .replace(/vars\.(\w+)/g, (_, k) => JSON.stringify(ctx.vars?.[k] ?? ''))
    .replace(/'([^']*)'/g, (_, s) => JSON.stringify(s));
  assert.doesNotMatch(js, /[a-z_]+\.[a-z_]+/i, `unhandled expression: ${expr}`);
  return Function(`return (${js});`)();
}

/** Which jobs a tag runs: the plan's outputs through each job's `if:`. */
function jobsFor(tag, vars = { BUILD_IOS: 'true' }) {
  const plan = planBuild({ refType: 'tag', refName: tag, files: filesAt(parseTag(tag).version) });
  const ctx = { plan, vars, ref: `refs/tags/${tag}`, results: { plan: 'success' } };
  const ran = [];
  for (const name of ['desktop', 'android', 'ios']) if (evaluate(jobs[name].if, ctx)) ran.push(name);
  const desktop = ran.includes('desktop') ? JSON.parse(plan.desktop_matrix) : [];
  return { ran, desktop, plan };
}

test('every app tag and the old vX tag start the workflow', () => {
  const tags = wf.on.push.tags;
  for (const p of ['v*', 'android-v*', 'ios-v*', 'windows-v*', 'macos-v*', 'linux-v*']) assert.ok(tags.includes(p), p);
});

test('each tag runs exactly its own jobs', () => {
  assert.deepEqual(jobsFor('android-v0.4.25'), { ran: ['android'], desktop: [], plan: jobsFor('android-v0.4.25').plan });
  assert.deepEqual(jobsFor('ios-v0.4.25').ran, ['ios']);
  assert.deepEqual(jobsFor('windows-v0.4.25').desktop, ['windows-latest']);
  assert.deepEqual(jobsFor('windows-v0.4.25').ran, ['desktop']);
  assert.deepEqual(jobsFor('macos-v0.4.25').desktop, ['macos-latest']);
  assert.deepEqual(jobsFor('macos-v0.4.25').ran, ['desktop']);
  assert.deepEqual(jobsFor('linux-v0.4.25').desktop, ['ubuntu-latest']);
  assert.deepEqual(jobsFor('linux-v0.4.25').ran, ['desktop']);
  // The old tags still build everything.
  const legacy = jobsFor('v0.4.25');
  assert.deepEqual(legacy.ran, ['desktop', 'android', 'ios']);
  assert.deepEqual([...legacy.desktop].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest']);
  // iOS stays off without the repo variable, whatever the tag.
  assert.deepEqual(jobsFor('ios-v0.4.25', {}).ran, []);
});

test('the jobs take their plan from the plan job', () => {
  for (const name of ['desktop', 'android', 'ios']) assert.deepEqual([jobs[name].needs].flat(), ['plan'], name);
  assert.equal(jobs.desktop.strategy.matrix.platform, '${{ fromJSON(needs.plan.outputs.desktop_matrix) }}');
  for (const key of ['version', 'desktop_matrix', 'android', 'ios', 'title']) {
    assert.equal(jobs.plan.outputs[key], `\${{ steps.plan.outputs.${key} }}`, key);
  }
  assert.ok(jobs.plan.steps.some((s) => s.id === 'plan' && /native-plan\.mjs/.test(s.run)));
});

test('a branch push or a manual run builds as before', () => {
  const plan = planBuild({ refType: 'branch', refName: 'feat/windows-desktop', files });
  assert.deepEqual(JSON.parse(plan.desktop_matrix), ['windows-latest', 'ubuntu-latest']);
  assert.equal(plan.android, 'true');
  assert.equal(plan.ios, 'true');
  assert.equal(plan.version, '');
});

test('the release job runs after skipped jobs, never after a failed or cancelled one', () => {
  const rel = jobs.release;
  assert.deepEqual(rel.needs, ['plan', 'desktop', 'android']);
  const releases = (ref, results) => evaluate(rel.if, { ref, results, plan: {} });
  const tag = 'refs/tags/windows-v0.4.25';
  assert.equal(releases(tag, { plan: 'success', desktop: 'success', android: 'skipped' }), true);
  assert.equal(releases('refs/tags/android-v0.4.25', { plan: 'success', desktop: 'skipped', android: 'success' }), true);
  assert.equal(releases('refs/tags/ios-v0.4.25', { plan: 'success', desktop: 'skipped', android: 'skipped' }), true);
  assert.equal(releases('refs/tags/v0.4.25', { plan: 'success', desktop: 'success', android: 'success' }), true);
  assert.equal(releases(tag, { plan: 'success', desktop: 'failure', android: 'skipped' }), false);
  assert.equal(releases('refs/tags/v0.4.25', { plan: 'success', desktop: 'success', android: 'failure' }), false);
  assert.equal(releases(tag, { plan: 'success', desktop: 'cancelled', android: 'skipped' }), false);
  // A failed plan (tag and version file disagree) skips every build: still no release.
  assert.equal(releases(tag, { plan: 'failure', desktop: 'skipped', android: 'skipped' }), false);
  // Branch pushes never release.
  assert.equal(releases('refs/heads/feat/windows-desktop', { plan: 'success', desktop: 'success', android: 'success' }), false);
  // The evaluator itself: the old condition, with GitHub's implied
  // success(), lost the release whenever a job was skipped.
  const old = (results) => evaluate("startsWith(github.ref, 'refs/tags/')", { ref: tag, results, plan: {} });
  assert.equal(old({ plan: 'success', desktop: 'success', android: 'skipped' }), false);
  assert.equal(old({ plan: 'success', desktop: 'success', android: 'success' }), true);
});

test('assets are named from the bare version, the release from the tag', () => {
  const steps = jobs.release.steps;
  const rename = steps.find((s) => /Rename/.test(s.name));
  assert.equal(rename.env.VERSION, '${{ needs.plan.outputs.version }}');
  assert.equal(rename.env.TAG, undefined);
  assert.doesNotMatch(rename.run, /\$\{?TAG\b/);
  assert.match(rename.run, /out="Ember-v\$\{VERSION\}-android\.apk"/);
  assert.match(rename.run, /out="Ember-v\$\{VERSION\}-windows-x64-setup\.exe"/);
  const publish = steps.find((s) => /Publish/.test(s.name));
  assert.equal(publish.env.TAG, '${{ github.ref_name }}');
  assert.equal(publish.env.TITLE, '${{ needs.plan.outputs.title }}');
  assert.match(publish.run, /--title "\$TITLE"/);
  // An iOS tag has nothing to upload; the step must not fail on that.
  assert.match(publish.run, /compgen -G "dist\/\*"/);
  assert.equal(jobsFor('windows-v0.4.26').plan.title, 'Ember Windows 0.4.26');
  assert.equal(jobsFor('ios-v0.4.26').plan.title, 'Ember iOS 0.4.26');
  assert.equal(jobsFor('v0.4.26').plan.title, 'Ember v0.4.26');
});

test('iOS takes the version from the tag, not from the web app', () => {
  const step = jobs.ios.steps.find((s) => s.name === 'Version and build number');
  assert.equal(step.env.TAG_VERSION, '${{ needs.plan.outputs.version }}');
  assert.doesNotMatch(step.run, /apps\/web\/package\.json/);
  assert.match(step.run, /MARKETING_VERSION/);
});

test('the plan stops a tag whose version is not the app\'s', () => {
  const real = (tag) => () => planBuild({ refType: 'tag', refName: tag, files });
  for (const o of OSES) {
    const v = readOsVersion(o, files);
    assert.doesNotThrow(real(`${o}-v${v}`), o);
    assert.throws(real(`${o}-v9.9.9`), new RegExp(`${o} is ${v.replace(/\./g, '\\.')} in ${FILES[OS_FILE[o]].replace(/\./g, '\\.')}`));
  }
  // An old-style tag checks every app whose binary reads its version file.
  const mixed = { ...filesAt('0.4.25'), ...bumpOs('linux', filesAt('0.4.25'), '0.4.24') };
  assert.throws(() => planBuild({ refType: 'tag', refName: 'v0.4.25', files: mixed }), /linux is 0\.4\.24/);
  assert.throws(() => planBuild({ refType: 'tag', refName: 'v0.5.0-rc1', files }), /not a release tag/);
  assert.throws(() => planBuild({ refType: 'tag', refName: 'web-v0.7.31', files }), /not a release tag/);
});

test('the plan script writes its outputs for GitHub, and fails on a wrong tag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-plan-'));
  const out = path.join(dir, 'out');
  const v = readOsVersion('android', files);
  const run = (name) =>
    execFileSync('node', ['.github/scripts/native-plan.mjs'], {
      cwd: ROOT,
      env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: name, GITHUB_OUTPUT: out },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  run(`android-v${v}`);
  const written = fs.readFileSync(out, 'utf8');
  assert.match(written, new RegExp(`^version=${v.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(written, /^desktop_matrix=\[\]$/m);
  assert.match(written, /^android=true$/m);
  assert.match(written, /^ios=false$/m);
  assert.throws(() => run('android-v9.9.9'), (e) => e.status === 1 && /::error::Tag android-v9\.9\.9/.test(e.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an Android release is never signed with a throwaway debug key', () => {
  // Without keystore.properties build.gradle signs with the debug key, which
  // a CI runner makes anew on every run. v0.4.17 and v0.4.18 shipped that
  // way: no phone could ever update to or from them. A branch build may
  // still fall back; a release tag must fail instead.
  const steps = jobs.android.steps;
  const at = (re) => steps.findIndex((s) => re.test(s.name ?? ''));
  const guard = steps[at(/^Require the release key/)];
  assert.ok(guard, 'no release key guard in the android job');
  assert.ok(at(/^Restore release keystore/) < at(/^Require the release key/));
  assert.ok(at(/^Require the release key/) < at(/^Build release APK/));
  assert.equal(guard['working-directory'], 'apps/mobile/android');
  const runsOn = (ref) => evaluate(guard.if, { ref, results: { plan: 'success' }, plan: {} });
  assert.equal(runsOn('refs/tags/android-v0.4.25'), true);
  assert.equal(runsOn('refs/tags/v0.4.26'), true);
  assert.equal(runsOn('refs/heads/main'), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-key-'));
  const run = () => execFileSync('bash', ['-e', '-c', guard.run], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(run, (e) => e.status === 1 && /::error::/.test(e.stdout));
  fs.writeFileSync(path.join(dir, 'keystore.properties'), 'storeFile=ember-release.keystore\n');
  assert.doesNotThrow(run);
  fs.rmSync(dir, { recursive: true, force: true });
});
