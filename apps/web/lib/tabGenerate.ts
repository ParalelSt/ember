import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GENERATED_DIR } from '@/lib/tabs';
import { queuePythonJob } from '@/lib/pythonJobs';
import { serverLogger } from '@/lib/logger/server';
import { isOptionalDepMissing, warnOptionalDepsOnce } from '@/lib/tabOptionalDeps';

/** Guitar tabs generated from the recording itself.
 *
 *  transcribe.py (repo root) does the work; this module decides WHEN it runs:
 *  once per track, one at a time. A transcription costs minutes of CPU on the
 *  host, and the same machine is streaming audio to everyone, so two jobs in
 *  parallel would make the player stutter.
 *
 *  The .alphatex file on disk is the job state (delete it and the next
 *  request regenerates); the `tabs` row the route records beside it
 *  (lib/tabStore.ts recordGenerated) is the metadata that makes it findable
 *  by song. */

const ROOT = path.resolve(process.cwd(), '..', '..');
const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const TRANSCRIBE_SCRIPT = process.env.TRANSCRIBE_SCRIPT ?? path.join(ROOT, 'transcribe.py');

/** Demucs on a four-minute song takes a few minutes on this hardware.
 *  Exported so tests can advance fake timers past it exactly, rather than
 *  hardcoding the same number in two places. */
export const TIMEOUT_MS = 10 * 60 * 1000;

const SOURCE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface TrackKey {
  source: 'youtube' | 'upload';
  sourceId: string;
  /** Filename stem on disk: `<source>-<sourceId>`. */
  key: string;
}

/** `youtube:<videoId>` or `upload:<pbId>`: the app's compound Track id.
 *  Anything else is refused, which also rules out traversal: the key only
 *  ever contains [A-Za-z0-9_-] and one dash. */
export function parseTrackKey(trackId: string): TrackKey | null {
  const i = trackId.indexOf(':');
  if (i <= 0) return null;
  const source = trackId.slice(0, i);
  const sourceId = trackId.slice(i + 1);
  if (source !== 'youtube' && source !== 'upload') return null;
  if (!SOURCE_ID_RE.test(sourceId)) return null;
  return { source, sourceId, key: `${source}-${sourceId}` };
}

export function generatedTabFile(key: string): string {
  return `${key}.alphatex`;
}

export function generatedTabPath(key: string): string {
  return path.join(GENERATED_DIR, generatedTabFile(key));
}

// ── can this host generate at all? ─────────────────────────────────────

export interface GeneratorStatus {
  /** transcribe.py can run here. */
  available: boolean;
  /** Python modules (and "ffmpeg", "python") it lacks, by import name. */
  missing: string[];
}

/** How long an answer is kept: installing the tools takes effect without a
 *  restart (each job is a fresh Python), so this is not forever. */
export const TOOLS_TTL_MS = 5 * 60 * 1000;

interface CheckRun {
  code: number | null;
  stdout: string;
}

let toolsCache: { at: number; value: GeneratorStatus } | null = null;
let toolsInflight: Promise<GeneratorStatus> | null = null;

/** For tests: forget the last answer. */
export function resetGeneratorStatus(): void {
  toolsCache = null;
  toolsInflight = null;
}

function runCheck(): Promise<CheckRun> {
  return new Promise((resolve) => {
    let stdout = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(PYTHON_BIN, [TRANSCRIBE_SCRIPT, '--check'], {
        env: { ...process.env, PATH: `${path.dirname(PYTHON_BIN)}:${process.env.PATH ?? ''}` },
      });
    } catch {
      resolve({ code: null, stdout: '' });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, stdout: '' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

/** `transcribe.py --check`'s answer, or null when it gave none. */
export function readCheck(run: CheckRun): GeneratorStatus | null {
  const line = run.stdout.trim().split('\n').pop() ?? '';
  try {
    const j = JSON.parse(line) as { ok?: unknown; missing?: unknown };
    if (typeof j.ok !== 'boolean') return null;
    const missing = Array.isArray(j.missing) ? j.missing.filter((m): m is string => typeof m === 'string').slice(0, 20) : [];
    return { available: j.ok, missing };
  } catch {
    return null;
  }
}

/** The last answer while it is fresh, else null (no await, so a route
 *  that has one answers at once). */
export function cachedGeneratorStatus(now: () => number = Date.now): GeneratorStatus | null {
  return toolsCache && now() - toolsCache.at < TOOLS_TTL_MS ? toolsCache.value : null;
}

/** Whether "Generate a tab" can work on this host (the page greys it out
 *  when not): transcribe.py's own `--check`, which looks for Basic Pitch
 *  and the rest without loading them. Cached for TOOLS_TTL_MS. A check that
 *  gives no answer at all does not block: the job then says what failed. */
export async function generatorStatus(deps: { run?: () => Promise<CheckRun>; now?: () => number } = {}): Promise<GeneratorStatus> {
  const now = deps.now ?? Date.now;
  if (toolsCache && now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.value;
  if (toolsInflight) return toolsInflight;
  const job = (async (): Promise<GeneratorStatus> => {
    // The sandbox's stand-in (tests/fake-transcribe.sh) needs nothing.
    if (!deps.run && !TRANSCRIBE_SCRIPT.endsWith('.py')) return { available: true, missing: [] };
    if (!deps.run && !fs.existsSync(PYTHON_BIN)) return { available: false, missing: ['python'] };
    const answer = readCheck(await (deps.run ?? runCheck)());
    return answer ?? { available: true, missing: [] };
  })()
    .then((value) => {
      toolsCache = { at: now(), value };
      if (!value.available) warnOptionalDepsOnce();
      return value;
    })
    .finally(() => {
      toolsInflight = null;
    });
  toolsInflight = job;
  return job;
}

const running = new Map<string, Promise<void>>();
const lastError = new Map<string, string>();
/** Keys whose POST has committed to a job but hasn't reached startGeneration
 *  yet (still awaiting ensureDownloaded, below `running`'s own entry). Without
 *  this, a GET that lands during that download sees neither the file nor a
 *  `running` entry and answers 404 "none" — as if nothing had been asked for,
 *  while the POST that asked is still in flight. */
const pending = new Set<string>();

export type GenerationStatus =
  | { status: 'ready' }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'none' };

export function generationStatus(key: string): GenerationStatus {
  if (fs.existsSync(generatedTabPath(key))) return { status: 'ready' };
  if (running.has(key) || pending.has(key)) return { status: 'running' };
  const error = lastError.get(key);
  if (error) return { status: 'failed', error };
  return { status: 'none' };
}

/** Mark `key` as claimed before the (possibly slow) audio fetch starts, so
 *  concurrent GETs poll as "running" instead of "none". Call `clearPending`
 *  once `startGeneration` has been called (or the attempt was abandoned). */
export function markPending(key: string): void {
  pending.add(key);
}

export function clearPending(key: string): void {
  pending.delete(key);
}

/** Start (or join) the job for `key`. Resolves when the file exists; rejects
 *  with a one-line reason. The reason is also remembered so a GET can show
 *  it after the fact. */
export function startGeneration(key: string, audioPath: string, title: string): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;
  lastError.delete(key);

  // The queue of one (lib/pythonJobs.ts): every Python job waits for the
  // one before it, success or not.
  const job = queuePythonJob(() => runScript(audioPath, generatedTabPath(key), title))
    .catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e);
      lastError.set(key, reason);
      if (isOptionalDepMissing(reason)) {
        warnOptionalDepsOnce();
      } else {
        serverLogger.error('tabs', 'generation failed', { key, reason });
      }
      throw e;
    })
    .finally(() => running.delete(key));

  running.set(key, job);
  return job;
}

/** transcribe.py decodes into a `tempfile.TemporaryDirectory(prefix=
 *  "ember-transcribe-")` under the OS tmp dir, cleaned up by its own `with`
 *  block on a normal exit. SIGKILL (below, on timeout) gives Python no chance
 *  to run that cleanup, so the wav dir is left behind. Only one transcription
 *  job ever runs at a time (the queue in startGeneration above), so any such
 *  dir still around when a job ends is this job's leftover and safe to sweep. */
function sweepTranscribeTmpDirs(): void {
  const tmpRoot = os.tmpdir();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('ember-transcribe-')) continue;
    try {
      fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true });
    } catch {
      // best effort — a stray dir next run is better than crashing this one
    }
  }
}

function runScript(audioPath: string, outPath: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    // The real script runs under the venv's Python; the test sandbox points
    // TRANSCRIBE_SCRIPT at a shell script instead, which runs on its own.
    const isPython = TRANSCRIBE_SCRIPT.endsWith('.py');
    const cmd = isPython ? PYTHON_BIN : TRANSCRIBE_SCRIPT;
    // `--title=<value>` (not `--title <value>`) so a hyphen-leading,
    // space-free title can't be misread by argparse as another option.
    const args = [...(isPython ? [TRANSCRIBE_SCRIPT] : []), audioPath, outPath, `--title=${title}`];
    const child = spawn(cmd, args, {
      env: { ...process.env, PATH: `${path.dirname(PYTHON_BIN)}:${process.env.PATH ?? ''}` },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      sweepTranscribeTmpDirs();
      reject(new Error('transcription timed out'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.stdout.on('data', () => {}); // keep the pipe drained
    child.on('error', (e) => {
      clearTimeout(timer);
      sweepTranscribeTmpDirs();
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // A clean exit already cleaned up after itself (transcribe.py's own
      // `with` block); this only matters after a kill or crash, but it's
      // cheap enough to run unconditionally rather than track which case.
      sweepTranscribeTmpDirs();
      if (code === 0 && fs.existsSync(outPath)) return resolve();
      // The script's own last line is the useful part; everything above it is
      // a traceback or a model warning.
      const lines = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/warning/i.test(l));
      reject(new Error(lines[lines.length - 1]?.slice(0, 200) || `transcription failed (exit ${code ?? '?'})`));
    });
  });
}
