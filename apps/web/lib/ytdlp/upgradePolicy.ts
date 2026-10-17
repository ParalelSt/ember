/** When the host's yt-dlp should be upgraded. Pure (no timers, no disk, no
 *  pip), so the rules test without a host.
 *
 *  Two triggers:
 *  - daily: at most once every 24 hours.
 *  - 403s: YouTube breaks old yt-dlp versions every few months and the
 *    symptom is "HTTP Error 403: Forbidden" on downloads. A few of those in a
 *    short window ask for an upgrade soon, but never more often than every
 *    3 hours, so a 403 that an upgrade does not cure cannot cause a pip loop. */

export const DAILY_MS = 24 * 60 * 60 * 1000;
export const FAILURE_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const FAILURE_THRESHOLD = 3;

/** True for the yt-dlp error text of a YouTube 403 on a download. */
export function is403Message(message: string): boolean {
  return /\b403\b|forbidden/i.test(message);
}

/** Counts 403s inside a sliding window. */
export function createFailureCounter(windowMs = FAILURE_WINDOW_MS) {
  let stamps: number[] = [];
  return {
    /** Records one failure, returns how many fall inside the window now. */
    record(now: number): number {
      stamps = stamps.filter((t) => now - t < windowMs);
      stamps.push(now);
      return stamps.length;
    },
    reset(): void {
      stamps = [];
    },
  };
}

export interface UpgradeState {
  /** ms timestamp of the last attempt (success or not), null if never. */
  lastAttemptAt: number | null;
  running: boolean;
  enabled: boolean;
}

export function dailyDue(now: number, s: UpgradeState): boolean {
  if (!s.enabled || s.running) return false;
  return s.lastAttemptAt === null || now - s.lastAttemptAt >= DAILY_MS;
}

export function failureDue(now: number, recentFailures: number, s: UpgradeState): boolean {
  if (!s.enabled || s.running) return false;
  if (recentFailures < FAILURE_THRESHOLD) return false;
  return s.lastAttemptAt === null || now - s.lastAttemptAt >= FAILURE_COOLDOWN_MS;
}

/** YTDLP_AUTO_UPGRADE=0 and SKIP_YTDLP_UPGRADE=1 (update.sh's own switch)
 *  both turn the whole thing off. */
export function upgradeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.YTDLP_AUTO_UPGRADE === '0') return false;
  if (env.SKIP_YTDLP_UPGRADE === '1') return false;
  return true;
}
