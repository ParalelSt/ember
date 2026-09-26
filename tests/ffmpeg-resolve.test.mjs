/** Ember's own ffmpeg: update.sh installs
 *  imageio-ffmpeg and links its binary to .venv/bin/ffmpeg, and the Python
 *  resolver (ffmpeg_path.py) finds it with nothing on PATH.
 *
 *      node tests/ffmpeg-resolve.test.mjs      # or: npm run test:ffmpeg
 *
 *  update.sh is copied into a temp root per scenario with a fake `.venv`:
 *  `pip` only records its arguments (no network), `python` hands over to a
 *  real Python that has imageio-ffmpeg (PYTHON_BIN, else the repo's
 *  .venv/bin/python). UPDATE_FFMPEG_ONLY=1 runs just that step, no git.
 *  Then the Python unit tests (tests/test_ffmpeg_path.py) run with the same
 *  Python. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const venvPy = path.join(ROOT, '.venv/bin/python');
const PYTHON = process.env.PYTHON_BIN ?? (fs.existsSync(venvPy) ? venvPy : 'python3');

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const hasBundled = spawnSync(PYTHON, ['-c', 'import imageio_ffmpeg'], { encoding: 'utf8' }).status === 0;
if (!hasBundled) {
  console.error(`${PYTHON} has no imageio-ffmpeg; set PYTHON_BIN to a Python that has it`);
  process.exit(2);
}

/** A temp Ember root with update.sh and a fake venv. `python` is a wrapper
 *  around the real one, or a script that fails when `brokenPython`. */
function makeRoot({ pip = true, brokenPython = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-ffmpeg-'));
  fs.copyFileSync(path.join(ROOT, 'update.sh'), path.join(dir, 'update.sh'));
  const bin = path.join(dir, '.venv/bin');
  fs.mkdirSync(bin, { recursive: true });
  if (pip) {
    fs.writeFileSync(path.join(bin, 'pip'), `#!/bin/sh\necho "$@" >> "${dir}/pip.log"\n`, { mode: 0o755 });
  }
  const py = brokenPython ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\nexec "${PYTHON}" "$@"\n`;
  fs.writeFileSync(path.join(bin, 'python'), py, { mode: 0o755 });
  return dir;
}

function runStep(dir) {
  return spawnSync('bash', [path.join(dir, 'update.sh')], {
    cwd: dir,
    encoding: 'utf8',
    // /usr/bin:/bin only: no Homebrew ffmpeg to hide a broken link.
    env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', UPDATE_FFMPEG_ONLY: '1' },
    timeout: 60_000,
  });
}

// ── update.sh links the bundled binary ─────────────────────────────────────
{
  const dir = makeRoot();
  const r = runStep(dir);
  const link = path.join(dir, '.venv/bin/ffmpeg');
  check('the ffmpeg step exits 0', r.status === 0, (r.stderr || '').trim().slice(0, 200));
  const pipLog = fs.existsSync(path.join(dir, 'pip.log')) ? fs.readFileSync(path.join(dir, 'pip.log'), 'utf8') : '';
  check('pip installs imageio-ffmpeg', /install -q imageio-ffmpeg/.test(pipLog), pipLog.trim());
  const isLink = fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink();
  const target = isLink ? fs.readlinkSync(link) : '';
  check('.venv/bin/ffmpeg is a symlink into imageio_ffmpeg', isLink && target.includes('imageio_ffmpeg'), target);
  let version = '';
  try {
    version = execFileSync(link, ['-version'], { encoding: 'utf8', timeout: 30_000 });
  } catch {
    // reported below
  }
  check('the linked ffmpeg runs', /^ffmpeg version/.test(version), version.split('\n')[0]);
  check('the step says where it linked', r.stdout.includes('.venv/bin/ffmpeg ->'), r.stdout.trim().split('\n').pop());

  // Again: a stale link (the package upgraded and renamed its binary) is
  // replaced, not left pointing nowhere.
  fs.unlinkSync(link);
  fs.symlinkSync(path.join(dir, 'gone/ffmpeg-old'), link);
  const again = runStep(dir);
  check('a second run relinks a stale link', again.status === 0 && fs.readlinkSync(link) === target);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── nothing to do without a venv, a clear warning without the binary ───────
{
  const dir = makeRoot({ pip: false });
  const r = runStep(dir);
  check('no venv pip: the step is skipped quietly', r.status === 0 && !fs.existsSync(path.join(dir, '.venv/bin/ffmpeg')) && r.stdout.trim() === '', r.stdout.trim());
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = makeRoot({ brokenPython: true });
  const r = runStep(dir);
  check('no binary: a warning, no link, the update carries on', r.status === 0 && /⚠/.test(r.stdout) && !fs.existsSync(path.join(dir, '.venv/bin/ffmpeg')), r.stdout.trim().split('\n').pop());
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── the resolver itself: the Python unit tests ─────────────────────────────
{
  const r = spawnSync(PYTHON, ['-m', 'unittest', 'tests/test_ffmpeg_path.py'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  const tail = (r.stderr || '').trim().split('\n').slice(-3).join(' ');
  check('tests/test_ffmpeg_path.py passes (resolver with PATH stripped, decode, player wiring)', r.status === 0, tail);
}

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
