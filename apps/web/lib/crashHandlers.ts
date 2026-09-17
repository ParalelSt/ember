import { spawn } from 'node:child_process';
import path from 'node:path';

/** Last-resort catch for errors nothing else handled in the Node server.
 *  Installed from instrumentation.ts register(). Each one is written to the
 *  server log with its stack and posted to Discord through
 *  scripts/crash-report.mjs (the same poster the start-static.sh watchdog
 *  uses), then an uncaught exception ends the process so the watchdog starts
 *  a clean one. */

export interface CrashHandlerDeps {
  /** serverLogger.error in production. */
  log: (category: string, message: string, data?: unknown, err?: unknown) => void;
  /** Starts the Discord poster without waiting for it. */
  spawnReport: (title: string, text: string) => void;
  exit: (code: number) => void;
  /** Gives the fire-and-forget log append time to land before exit. */
  flushDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

// Past this many distinct messages the process is producing a flood of
// different errors; stop spawning posters (the log still gets every one).
const MAX_DISTINCT_REPORTS = 50;

export function createCrashHandlers(deps: CrashHandlerDeps) {
  const flushDelayMs = deps.flushDelayMs ?? 500;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const reported = new Set<string>();
  let exiting = false;

  function handle(kind: 'uncaughtException' | 'unhandledRejection', reason: unknown) {
    const err = reason instanceof Error ? reason : new Error(describe(reason));
    const message = err.message || String(reason);
    const stack = err.stack || message;

    try {
      deps.log('crash', `${kind}: ${message}`, undefined, err);
    } catch {
      // Logging must never stop the report or the exit below.
    }

    // A crash loop would otherwise post the same error on every request.
    if (!reported.has(message) && reported.size < MAX_DISTINCT_REPORTS) {
      reported.add(message);
      try {
        deps.spawnReport(`Server error: ${message.slice(0, 100)}`, `${kind}\n${stack}`);
      } catch {
        // Same: a failed spawn is not a reason to keep a broken process alive.
      }
    }

    // uncaughtException: the throw unwound through code that did not expect
    // it, so in-memory state may be half-updated. Exit and let the watchdog
    // start a fresh process.
    //
    // unhandledRejection: logged and reported, but the process keeps running.
    // Next's own handler already keeps the server alive on these today, and
    // a stray rejection (an aborted fetch, a client that hung up) rarely
    // leaves shared state broken. Exiting on each one would turn a noisy but
    // working server into a restart loop that the watchdog gives up on after
    // five, taking the site down for something users never noticed.
    if (kind === 'uncaughtException' && !exiting) {
      exiting = true;
      setTimer(() => deps.exit(1), flushDelayMs);
    }
  }

  return {
    onUncaughtException: (err: unknown) => handle('uncaughtException', err),
    onUnhandledRejection: (reason: unknown) => handle('unhandledRejection', reason),
  };
}

function describe(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/** Runs the poster detached, so it outlives this process when an uncaught
 *  exception is about to end it. The server's cwd is apps/web (the same
 *  assumption lib/logger/server.ts makes for logs/). */
export function spawnCrashReport(title: string, text: string): void {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'crash-report.mjs'), '--title', title, '--text', text], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
}

let installed = false;

/** Registers the handlers once per process (register() can run again in dev
 *  after a reload, and duplicate handlers would double-report). */
export function installCrashHandlers(deps: CrashHandlerDeps): void {
  if (installed) return;
  installed = true;
  const handlers = createCrashHandlers(deps);
  process.on('uncaughtException', handlers.onUncaughtException);
  process.on('unhandledRejection', handlers.onUnhandledRejection);
}
