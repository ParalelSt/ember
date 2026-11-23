import { PagePerf } from './core';
import type { PerfBlock } from './types';

/** The page's one perf recorder. Booted by lib/perf/client.ts. */
export const pagePerf = new PagePerf();

/** The perf block for a bug report or automatic report. Never throws: a
 *  report must go out even if this fails. */
export function perfBlock(): PerfBlock | undefined {
  try {
    return pagePerf.block();
  } catch {
    return undefined;
  }
}

/** Counts something on the perf log (a click cancelled by a long press, a
 *  native event). Cheap: a map lookup and an add. */
export function perfCount(name: string, by = 1): void {
  pagePerf.count(name, by);
}
