import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TAB_DIR } from '@/lib/tabs';
import { serverLogger } from '@/lib/logger/server';

/** Guitar tabs generated from the recording itself.
 *
 *  transcribe.py (repo root) does the work; this module decides WHEN it runs:
 *  once per track, one at a time. A transcription costs minutes of CPU on the
 *  host, and the same machine is streaming audio to everyone, so two jobs in
 *  parallel would make the player stutter.
 *
 *  No database row: the .alphatex file on disk IS the state. Delete it and
 *  the next request regenerates. */

const ROOT = path.resolve(process.cwd(), '..', '..');
const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const TRANSCRIBE_SCRIPT = process.env.TRANSCRIBE_SCRIPT ?? path.join(ROOT, 'transcribe.py');
export const GENERATED_DIR = path.join(TAB_DIR, 'generated');

/** Demucs on a four-minute song takes a few minutes on this hardware. */
const TIMEOUT_MS = 10 * 60 * 1000;

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

export function generatedTabPath(key: string): string {
  return path.join(GENERATED_DIR, `${key}.alphatex`);
}

const running = new Map<string, Promise<void>>();
const lastError = new Map<string, string>();
/** The queue of one: every job waits for the previous one, success or not. */
let chain: Promise<void> = Promise.resolve();

export type GenerationStatus =
  | { status: 'ready' }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'none' };

export function generationStatus(key: string): GenerationStatus {
  if (fs.existsSync(generatedTabPath(key))) return { status: 'ready' };
  if (running.has(key)) return { status: 'running' };
  const error = lastError.get(key);
  if (error) return { status: 'failed', error };
  return { status: 'none' };
}

/** Start (or join) the job for `key`. Resolves when the file exists; rejects
 *  with a one-line reason. The reason is also remembered so a GET can show
 *  it after the fact. */
export function startGeneration(key: string, audioPath: string, title: string): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;
  lastError.delete(key);

  const job = chain
    .then(() => runScript(audioPath, generatedTabPath(key), title))
    .catch((e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e);
      lastError.set(key, reason);
      serverLogger.error('tabs', 'generation failed', { key, reason });
      throw e;
    })
    .finally(() => running.delete(key));

  running.set(key, job);
  // The chain must never reject, or every later job would be skipped.
  chain = job.catch(() => {});
  return job;
}

function runScript(audioPath: string, outPath: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    // The real script runs under the venv's Python; the test sandbox points
    // TRANSCRIBE_SCRIPT at a shell script instead, which runs on its own.
    const isPython = TRANSCRIBE_SCRIPT.endsWith('.py');
    const cmd = isPython ? PYTHON_BIN : TRANSCRIBE_SCRIPT;
    const args = [...(isPython ? [TRANSCRIBE_SCRIPT] : []), audioPath, outPath, '--title', title];
    const child = spawn(cmd, args, {
      env: { ...process.env, PATH: `${path.dirname(PYTHON_BIN)}:${process.env.PATH ?? ''}` },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('transcription timed out'));
    }, TIMEOUT_MS);
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.stdout.on('data', () => {}); // keep the pipe drained
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
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
