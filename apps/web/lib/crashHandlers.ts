import { spawn } from 'node:child_process';
import path from 'node:path';

/** Last-resort catch for errors nothing else handled in the Node server.
 *  Installed from instrumentation.ts register(). Each one is written to the
 *  server log with its stack and posted to Discord through
 *  scripts/crash-report.mjs (the same poster the start-static.sh watchdog
 *  uses).
 *
 *  Neither kind ends the process. Next 16 deliberately keeps serving after an
 *  uncaughtException or unhandledRejection (its own handlers only log), and
 *  exiting here would turn one error that repeats on some request into a
 *  restart loop: five restarts, a give-up, and a site that stays down for
 *  everyone over a bug in one page. The report is what matters; the process
 *  keeps running. */

export interface CrashHandlerDeps {
  /** serverLogger.error in production. */
  log: (category: string, message: string, data?: unknown, err?: unknown) => void;
  /** Starts the Discord poster without waiting for it. */
  spawnReport: (title: string, text: string) => void;
}

// Past this many distinct messages the process is producing a flood of
// different errors; stop spawning posters (the log still gets every one).
const MAX_DISTINCT_REPORTS = 50;

export function createCrashHandlers(deps: CrashHandlerDeps) {
  const reported = new Set<string>();

  function handle(kind: 'uncaughtException' | 'unhandledRejection', reason: unknown) {
    const err = reason instanceof Error ? reason : new Error(describe(reason));
    const message = err.message || String(reason);
    const stack = err.stack || message;

    try {
      deps.log('crash', `${kind}: ${message}`, undefined, err);
    } catch {
      // Logging must never stop the report below, or throw from a handler.
    }

    // A crash loop would otherwise post the same error on every request.
    if (!reported.has(message) && reported.size < MAX_DISTINCT_REPORTS) {
      reported.add(message);
      try {
        deps.spawnReport(`Server error: ${message.slice(0, 100)}`, `${kind}\n${stack}`);
      } catch {
        // A handler that throws would itself be an uncaught exception.
      }
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

/** Runs the poster detached, in its own process group, so it outlives this
 *  process if the server is stopped while a report is still posting. The server's cwd is apps/web (the same
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
