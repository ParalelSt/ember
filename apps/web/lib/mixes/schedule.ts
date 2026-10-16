import { promises as fs } from 'node:fs';
import path from 'node:path';

/** When the nightly mix build runs: MIXES_HOUR (host local time, default
 *  4), once a day, checked every minute from instrumentation.ts like the
 *  error digest, with a marker file so a restart does not run it twice. */

export const DEFAULT_MIXES_HOUR = 4;

export function mixesHour(raw: string | undefined = process.env.MIXES_HOUR): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_MIXES_HOUR;
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** `<dir>/mixes-YYYY-MM-DD.built`. */
export function mixesMarkerPath(dir: string, now: Date): string {
  return path.join(dir, `mixes-${localDay(now)}.built`);
}

export async function markerExists(dir: string, now: Date): Promise<boolean> {
  return fs.access(mixesMarkerPath(dir, now)).then(() => true, () => false);
}

export async function writeMarker(dir: string, now: Date): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(mixesMarkerPath(dir, now), new Date(now).toISOString());
}

export function shouldBuildNow(now: Date, hour: number, done: boolean): boolean {
  return !done && now.getHours() >= hour;
}

/** One tick of the nightly schedule: runs `build` at most once a day, at or
 *  after the hour, never twice at once. The marker is written before the
 *  run, so a run that crashes the server is not retried in a loop (the
 *  lazy trigger covers the members it missed). */
export function createNightlyTick({ dir, hour, build, now = () => new Date(), warn = () => {} }: {
  dir: string;
  hour: number;
  build: () => Promise<unknown>;
  now?: () => Date;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
}) {
  let busy = false;
  return async function tick(): Promise<boolean> {
    if (busy) return false;
    const at = now();
    if (!shouldBuildNow(at, hour, await markerExists(dir, at))) return false;
    busy = true;
    try {
      await writeMarker(dir, at);
      await build();
    } catch (e) {
      warn('mixes: nightly build failed', { reason: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
    return true;
  };
}
