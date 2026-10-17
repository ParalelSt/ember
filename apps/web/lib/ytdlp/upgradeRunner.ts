import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { serverLogger, logDir } from '@/lib/logger/server';
import { forgetUpgradeFixable } from '@/lib/sources/failureMemo';
import { createUpgradeJob, type UpgradeResult } from './upgradeJob';
import { upgradeEnabled } from './upgradePolicy';

/** The venv the server already uses for player.py: PYTHON_BIN, else
 *  <repo>/.venv/bin/python (same rule as lib/sources/youtube). */
function venvBin(): string {
  const root = path.resolve(process.cwd(), '..', '..');
  const python = process.env.PYTHON_BIN ?? path.join(root, '.venv/bin/python');
  return path.dirname(python);
}

function exec(file: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

async function version(pip: string): Promise<string | null> {
  try {
    const { stdout } = await exec(pip, ['show', 'yt-dlp'], 30_000);
    return /^Version:\s*(\S+)/m.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function runPip(): Promise<UpgradeResult | null> {
  const pip = path.join(venvBin(), 'pip');
  try {
    await fs.access(pip);
  } catch {
    return null;
  }
  const before = await version(pip);
  try {
    await exec(pip, ['install', '-q', '-U', 'yt-dlp'], 3 * 60 * 1000);
  } catch (e) {
    const err = e as Error & { stderr?: string };
    return { ok: false, before, after: null, error: (err.stderr || err.message).slice(-300) };
  }
  return { ok: true, before, after: await version(pip) };
}

function markerFile(): string {
  return path.join(logDir(), 'ytdlp-upgrade.last');
}

const GLOBAL_KEY = Symbol.for('ember.ytdlpUpgradeJob');

/** One job per server process (routes are bundled separately, so a plain
 *  module-level singleton would be one per route). */
export function ytdlpUpgradeJob(): ReturnType<typeof createUpgradeJob> {
  const g = globalThis as Record<symbol, unknown>;
  return (g[GLOBAL_KEY] ??= createUpgradeJob({
    run: runPip,
    enabled: () => upgradeEnabled(),
    now: () => Date.now(),
    loadLastAttempt: async () => {
      const n = Number(await fs.readFile(markerFile(), 'utf8').catch(() => ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    saveLastAttempt: async (ts) => {
      await fs.mkdir(logDir(), { recursive: true });
      await fs.writeFile(markerFile(), String(ts));
    },
    log: (level, message, data) => serverLogger[level]('update', message, data),
    afterSuccess: () => forgetUpgradeFixable(),
  })) as ReturnType<typeof createUpgradeJob>;
}

/** For the stream route: never throws. */
export function noteYtdlpDownloadFailure(message: string): void {
  try {
    void ytdlpUpgradeJob().noteDownloadFailure(message).catch(() => {});
  } catch {
    // Housekeeping only.
  }
}
