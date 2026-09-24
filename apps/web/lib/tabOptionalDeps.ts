import 'server-only';
import { serverLogger } from '@/lib/logger/server';

/** Optional Python packages that alignment (align.py, numpy) and generation
 *  (transcribe.py, basic_pitch) need but the app doesn't: a host can run
 *  Ember fine without either installed, it just loses those two features.
 *  When one is missing this is *expected*, not a bug, so it should never
 *  spam the daily digest with an error per call. See SETUP.md. */
const OPTIONAL_MODULES = ['numpy', 'basic_pitch'];

/** True when `reason` (a caught error's message) is a ModuleNotFoundError
 *  for one of the optional packages above, as opposed to a real failure. */
export function isOptionalDepMissing(reason: string): boolean {
  return OPTIONAL_MODULES.some((m) => reason.includes(`ModuleNotFoundError: No module named '${m}'`));
}

let warned = false;

/** Logs the "these are off" warning once per server process, no matter how
 *  many alignment/generation calls hit the missing module in the meantime. */
export function warnOptionalDepsOnce(): void {
  if (warned) return;
  warned = true;
  serverLogger.warn('tabs', 'tab alignment is off: numpy/basic_pitch not installed, see SETUP.md');
}

/** For tests: forget that the one-time warning already fired. */
export function resetOptionalDepsWarning(): void {
  warned = false;
}
