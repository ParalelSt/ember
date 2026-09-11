'use client';

import { invoke } from '@tauri-apps/api/core';
import { detectShell } from '@/lib/playback/detectShell';

/** How much of ember-desktop.log to attach to a bug report. The Rust side caps
 *  the request at 500 lines. */
const TAIL_LINES = 200;
/** The IPC bridge can be absent or refused on a remote origin (see
 *  permissions/app-commands.toml), in which case invoke() may never settle.
 *  A bug report must not hang on a diagnostic extra. */
const TIMEOUT_MS = 2000;

/** The tail of the desktop app's own log, or '' when there isn't one.
 *
 *  Everything the shell does outside the WebView (audio engine, media controls,
 *  updater, the URL the window really loaded) is only in that file, so a report
 *  filed from the desktop app is missing half the story without it. Never
 *  throws: no shell, no bridge, a timeout or a refusal all mean 'no log'. */
export async function readDesktopLog(): Promise<string> {
  if (detectShell() !== 'tauri') return '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tail = await Promise.race([
      invoke<string>('log_tail', { lines: TAIL_LINES }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('log_tail timed out')), TIMEOUT_MS);
      }),
    ]);
    return typeof tail === 'string' ? tail : '';
  } catch {
    return '';
  } finally {
    // Otherwise the pending timer keeps the process (and vitest) awake for the
    // full timeout after a fast success.
    clearTimeout(timer);
  }
}
