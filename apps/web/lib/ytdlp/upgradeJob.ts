import { createFailureCounter, dailyDue, failureDue, is403Message, type UpgradeState } from './upgradePolicy';

export interface UpgradeResult {
  ok: boolean;
  before: string | null;
  after: string | null;
  error?: string;
}

export interface UpgradeJobDeps {
  /** Runs pip. Injected so tests never call it. Returns null when there is
   *  no venv/pip to run (the job then logs once and stops trying). */
  run: () => Promise<UpgradeResult | null>;
  enabled: () => boolean;
  now: () => number;
  loadLastAttempt: () => Promise<number | null>;
  saveLastAttempt: (ts: number) => Promise<void>;
  log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
  /** After a successful upgrade: let the songs that failed be retried. */
  afterSuccess: () => void;
  /** Hard stop for a pip that hangs. */
  timeoutMs?: number;
}

export function createUpgradeJob(deps: UpgradeJobDeps) {
  const counter = createFailureCounter();
  let lastAttemptAt: number | null = null;
  let loaded = false;
  let running = false;
  let missing = false;

  async function state(): Promise<UpgradeState> {
    if (!loaded) {
      loaded = true;
      try {
        lastAttemptAt = await deps.loadLastAttempt();
      } catch {
        lastAttemptAt = null;
      }
    }
    return { lastAttemptAt, running, enabled: deps.enabled() && !missing };
  }

  async function upgrade(reason: 'daily' | 'download-403s'): Promise<void> {
    running = true;
    const startedAt = deps.now();
    lastAttemptAt = startedAt;
    try {
      await deps.saveLastAttempt(startedAt).catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), deps.timeoutMs ?? 4 * 60 * 1000);
        timer.unref?.();
      });
      const result = await Promise.race([deps.run(), timeout]).finally(() => clearTimeout(timer));
      if (result === 'timeout') {
        deps.log('warn', 'yt-dlp upgrade timed out', { reason });
      } else if (result === null) {
        missing = true;
        deps.log('warn', 'yt-dlp auto-upgrade skipped: no venv pip found', { reason });
      } else if (result.ok) {
        deps.log('info', 'yt-dlp upgrade finished', { reason, before: result.before, after: result.after });
        counter.reset();
        try {
          deps.afterSuccess();
        } catch {
          // Forgetting failures is a courtesy; never fail the job over it.
        }
      } else {
        deps.log('warn', 'yt-dlp upgrade failed', { reason, before: result.before, error: result.error });
      }
    } catch (e) {
      deps.log('warn', 'yt-dlp upgrade crashed', { reason, error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  }

  return {
    /** Called on a timer; upgrades if a day has passed since the last try. */
    async tick(): Promise<boolean> {
      if (!dailyDue(deps.now(), await state())) return false;
      await upgrade('daily');
      return true;
    },
    /** Called where a download failure is seen; counts 403s only. */
    async noteDownloadFailure(message: string): Promise<boolean> {
      if (!is403Message(message)) return false;
      const now = deps.now();
      const n = counter.record(now);
      if (!failureDue(now, n, await state())) return false;
      void upgrade('download-403s');
      return true;
    },
    isRunning: () => running,
  };
}
