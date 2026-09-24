import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';
import { queuePythonJob } from '@/lib/pythonJobs';
import { buildTabPlan } from '@/lib/tabPlan';
import { resolveRowPath } from '@/lib/tabs';
import { parseTrackKey } from '@/lib/tabGenerate';
import { ensureDownloaded, findCachedFile } from '@/lib/sources/youtube';
import { resolveUploadPath } from '@/lib/uploads';
import { readTiming, type TabTiming } from '@/lib/tabSync';
import { isOptionalDepMissing, warnOptionalDepsOnce } from '@/lib/tabOptionalDeps';

/** Lining a tab up with the recording (docs/tabs-v3.md section 3).
 *
 *  align.py (repo root) does the listening; this module decides WHEN it
 *  runs: after a tab is fetched, or when someone presses "Line it up",
 *  once per tab, one Python job at a time for the whole server
 *  (lib/pythonJobs.ts, shared with the transcriber). It never blocks a
 *  page: the route starts it and answers, the page asks how it went.
 *
 *  What goes in: the tab as AlphaTab plays it (lib/tabPlan.ts, bars and
 *  notes on the tab's own clock) and the song's audio file, downloaded the
 *  way a transcription would if it is not cached yet. What comes out is
 *  the row's `timing` (offset_ms, bpm, confidence, bars), which the tab
 *  page maps its cursor through (lib/tabSync.ts). */

const ROOT = path.resolve(process.cwd(), '..', '..');
const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const ALIGN_SCRIPT = process.env.ALIGN_SCRIPT ?? path.join(ROOT, 'align.py');

/** Listening to a four-minute song takes about twenty seconds here; the
 *  cap is for a job that has gone wrong. */
const TIMEOUT_MS = 5 * 60 * 1000;

export type AlignStatus =
  | { status: 'ready'; timing: TabTiming }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'none' };

const running = new Map<string, Promise<TabTiming | null>>();
const lastError = new Map<string, string>();

/** For tests: forget what is running and what failed. */
export function resetAlignment(): void {
  running.clear();
  lastError.clear();
}

/** Where this tab's alignment stands, without asking the store. */
export function alignmentStatus(row: RecordModel): AlignStatus {
  if (running.has(row.id)) return { status: 'running' };
  const timing = readTiming(row.timing);
  if (timing) return { status: 'ready', timing };
  const error = lastError.get(row.id);
  if (error) return { status: 'failed', error };
  return { status: 'none' };
}

/** The recording behind a tab row: the track it was fetched for. Null when
 *  Ember has no audio for it (a tab added for a song it cannot play). */
export async function audioForTrack(trackId: string, pb: PocketBase): Promise<string | null> {
  const key = parseTrackKey(trackId);
  if (!key) return null;
  if (key.source === 'youtube') return findCachedFile(key.sourceId) ?? (await ensureDownloaded(key.sourceId));
  const row = await pb.collection('uploads').getOne(key.sourceId).catch(() => null);
  if (!row) return null;
  const full = resolveUploadPath(String(row.filename ?? ''));
  return full && (await fs.stat(full).then(() => true, () => false)) ? full : null;
}

export interface AlignDeps {
  /** A freshly signed-in admin client for the write at the end. */
  freshPb?: () => Promise<PocketBase>;
}

/** Line one tab up, unless it is already running. Resolves with the timing
 *  (null when nothing could be worked out). Never throws: a failure is
 *  logged and remembered for the page. */
export function alignTab(pb: PocketBase, row: RecordModel, deps: AlignDeps = {}): Promise<TabTiming | null> {
  const existing = running.get(row.id);
  if (existing) return existing;
  lastError.delete(row.id);
  const job = queuePythonJob(() => run(pb, row, deps))
    .catch(async (e: unknown) => {
      const reason = e instanceof Error ? e.message : String(e);
      lastError.set(row.id, reason.slice(0, 200));
      if (isOptionalDepMissing(reason)) {
        warnOptionalDepsOnce();
      } else {
        serverLogger.error('tabs', 'lining the tab up failed', { tab: row.id, reason });
      }
      // Remember the attempt even when it failed, so the automatic pass
      // never tries the same tab twice; "Line it up" still does.
      await markTried(pb, row, deps).catch(() => undefined);
      return null;
    })
    .finally(() => running.delete(row.id));
  running.set(row.id, job);
  return job;
}

/** Line up every row a search added, one after another, in the background.
 *  Errors are the job's own; nothing is awaited. */
export function alignInBackground(pb: PocketBase, rows: RecordModel[], deps: AlignDeps = {}): void {
  for (const row of rows) {
    void alignTab(pb, row, deps).catch(() => undefined);
  }
}

/** At most this many of a song's tabs are lined up on their own when the
 *  page opens. Listening costs a Python job each (lib/pythonJobs.ts runs
 *  one at a time), and past the best few the ranking has all it needs. */
export const MAX_AUTO_ALIGN = 4;

/** Has this tab been through align.py already? A row is marked the first
 *  time a job finishes for it, whether it worked or not, so the automatic
 *  pass never listens to the same tab twice (docs/tabs-v3.md stage 7). The
 *  "Line it up" button ignores this. */
export function alreadyTried(row: RecordModel): boolean {
  return !!row.aligned_at || !!readTiming(row.timing);
}

/** A row's source rank, the same order lib/tabPick.ts ranks the drawn tab
 *  in: a file, then Songsterr's notes, then Ultimate Guitar's text, then a
 *  pasted tab, then the generated one. */
function rowRank(row: RecordModel): number {
  const kind = String(row.kind ?? 'file');
  if (kind === 'generated') return 4;
  if (kind === 'pasted') return 3;
  if (kind === 'fetched') return row.source_site === 'songsterr' ? 1 : 2;
  return 0;
}

/** The rows an automatic pass should line up: the tabs Ember fetched that
 *  have never been through align.py, best source first, capped.
 *
 *  Only fetched tabs, on purpose. A file someone added and a text tab
 *  someone pasted are drawn from the song's start with the shared nudge, as
 *  they have been since docs/tab-sources.md, and a wrong alignment would
 *  move a tab that works today. So Ember never re-times one behind the
 *  listener's back: the Source sheet gives every row a "Line it up", and a
 *  score earned that way ranks exactly like a fetched tab's
 *  (lib/tabPick.ts). Pure, so the rule is testable. */
export function autoAlignQueue(rows: RecordModel[]): RecordModel[] {
  return rows
    .filter((r) => String(r.kind ?? '') === 'fetched' && !alreadyTried(r))
    .sort((a, b) => rowRank(a) - rowRank(b))
    .slice(0, MAX_AUTO_ALIGN);
}

async function markTried(pb: PocketBase, row: RecordModel, deps: AlignDeps): Promise<void> {
  const writer = deps.freshPb ? await deps.freshPb() : pb;
  await writer.collection('tabs').update(row.id, { aligned_at: new Date().toISOString() });
}

async function run(pb: PocketBase, row: RecordModel, deps: AlignDeps): Promise<TabTiming | null> {
  const texPath = resolveRowPath(row);
  if (!texPath) throw new Error('that tab has no file to read');
  const trackId = String(row.track_key || '');
  const audio = await audioForTrack(trackId, pb);
  if (!audio) throw new Error('Ember has no recording for that song yet');
  const tex = await fs.readFile(texPath, 'utf8');
  const plan = await buildTabPlan(tex);
  if (plan.notes.length < 4) throw new Error('that tab has too few notes to line up');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-align-'));
  const planPath = path.join(dir, 'plan.json');
  const outPath = path.join(dir, 'timing.json');
  try {
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
    await runScript(audio, planPath, outPath);
    const timing = readTiming(JSON.parse(await fs.readFile(outPath, 'utf8')));
    if (!timing) throw new Error('align.py wrote no timing');
    const writer = deps.freshPb ? await deps.freshPb() : pb;
    await writer.collection('tabs').update(row.id, { timing: toRow(timing), aligned_at: new Date().toISOString() });
    serverLogger.warn('tabs', 'tab lined up', {
      tab: row.id,
      offsetMs: timing.offsetMs,
      bpm: timing.bpm,
      confidence: timing.confidence,
      bars: timing.bars.length,
    });
    return timing;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The timing as the row keeps it (align.py's own shape). */
function toRow(t: TabTiming) {
  return { offset_ms: t.offsetMs, bpm: t.bpm, confidence: t.confidence, bars: t.bars };
}

function runScript(audio: string, planPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // The real script runs under the venv's Python; the sandbox can point
    // ALIGN_SCRIPT at a shell script instead, which runs on its own.
    const isPython = ALIGN_SCRIPT.endsWith('.py');
    const cmd = isPython ? PYTHON_BIN : ALIGN_SCRIPT;
    const args = [...(isPython ? [ALIGN_SCRIPT] : []), audio, planPath, outPath];
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, PATH: `${path.dirname(PYTHON_BIN)}:${process.env.PATH ?? ''}` },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('lining the tab up timed out'));
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
      if (code === 0) return resolve();
      const lines = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/warning/i.test(l));
      reject(new Error(lines[lines.length - 1]?.slice(0, 200) || `lining the tab up failed (exit ${code ?? '?'})`));
    });
  });
}
