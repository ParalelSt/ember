import 'server-only';
import { serverLogger } from '@/lib/logger/server';

/** Optional Python packages that lining a tab up with the recording
 *  (align.py: numpy, scipy, librosa and its soundfile) needs but the app
 *  doesn't: a host can run Ember fine without them, it just loses that one
 *  feature. When one is missing this is *expected*, not a bug, so it should
 *  never spam the daily digest with an error per call. See SETUP.md. */
const OPTIONAL_MODULES = ['numpy', 'scipy', 'librosa', 'soundfile'];

/** True when `reason` (a caught error's message) is a ModuleNotFoundError
 *  for one of the optional packages above, as opposed to a real failure. */
export function isOptionalDepMissing(reason: string): boolean {
  return OPTIONAL_MODULES.some((m) => reason.includes(`ModuleNotFoundError: No module named '${m}'`));
}

let warned = false;

/** Logs the "this is off" warning once per server process, no matter how
 *  many alignment calls hit the missing module in the meantime. */
export function warnOptionalDepsOnce(): void {
  if (warned) return;
  warned = true;
  serverLogger.warn('tabs', 'tab alignment is off: numpy/librosa not installed, see SETUP.md');
}

/** For tests: forget that the one-time warning already fired. */
export function resetOptionalDepsWarning(): void {
  warned = false;
}
