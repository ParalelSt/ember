import { detectShell } from '@/lib/playback/detectShell';
import { derive, type Scheme } from '@/lib/theme/derive';
import { resolveInputs, type ThemeDoc } from '@/lib/theme/model';
import { oklchToHex } from '@/lib/theme/oklch';

/** Telling the native shell about the theme (plan section 7). The page is
 *  already themed by the time this runs; what the shells paint is the chrome
 *  around it: Android's system bars, the blank before the first HTML byte
 *  and the bundled offline page, desktop's window background and title bar.
 *  Both keep the last value so the next cold start opens on it. */

export interface ShellTheme {
  /** The theme's background as `#rrggbb`. */
  background: string;
  scheme: Scheme;
  /** Every derived variable, Ember included: the Android offline page is
   *  another origin with no globals.css defaults of Ember's, so it needs the
   *  full set rather than the page's "no overrides" map. */
  vars: Record<string, string>;
}

/** How long the page waits after the last change before telling the shell,
 *  so dragging a colour picker is one native write, not sixty a second. */
export const SHELL_NOTIFY_DELAY_MS = 150;

export function shellTheme(doc: ThemeDoc): ShellTheme {
  const inputs = resolveInputs(doc);
  const { vars, scheme } = derive(inputs);
  return { background: oklchToHex(inputs.background), scheme, vars: { ...vars } };
}

interface EmberThemePlugin {
  apply(o: { background: string; scheme: Scheme; vars: string }): unknown;
}
type ShellWindow = {
  Capacitor?: { Plugins?: { EmberTheme?: EmberThemePlugin } };
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => unknown };
};

/** A rejected native call (an old build without the command, a refused ACL)
 *  must not become an unhandled rejection: the chrome just stays as it was. */
function swallow(result: unknown): void {
  if (result && typeof (result as Promise<unknown>).catch === 'function') {
    (result as Promise<unknown>).catch(() => {});
  }
}

/** Hand one theme to whichever shell hosts the page. A plain browser, an
 *  APK from before themes (no EmberTheme plugin) and a desktop build without
 *  `theme_apply` are all no-ops. Never throws. */
export function notifyShell(theme: ShellTheme): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as ShellWindow;
  try {
    switch (detectShell()) {
      case 'capacitor': {
        const plugin = win.Capacitor?.Plugins?.EmberTheme;
        if (typeof plugin?.apply !== 'function') return;
        swallow(plugin.apply({ background: theme.background, scheme: theme.scheme, vars: JSON.stringify(theme.vars) }));
        return;
      }
      case 'tauri': {
        const internals = win.__TAURI_INTERNALS__;
        if (typeof internals?.invoke !== 'function') return;
        swallow(internals.invoke('theme_apply', { background: theme.background, scheme: theme.scheme }));
        return;
      }
      default:
        return;
    }
  } catch {
    // Same as a missing plugin: the page is themed, the chrome is not.
  }
}
