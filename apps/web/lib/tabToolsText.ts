/** What the tab page says when this server cannot generate tabs: the
 *  optional Python tools (Basic Pitch and its helpers, see SETUP.md and
 *  requirements.txt) are not installed. Shared by the routes and the page,
 *  so a raw "ModuleNotFoundError: No module named 'basic_pitch'" never
 *  reaches a listener. */

export const TOOLS_MISSING_CODE = 'tools-missing';

export const TOOLS_MISSING_MESSAGE =
  'Generating a tab needs the optional tab tools on the server (Basic Pitch), and this server does not have them installed. Whoever runs it can add them (see SETUP.md).';

/** Short form, for a disabled button's label. */
export const TOOLS_MISSING_SHORT = 'Needs the optional tab tools on the server';

/** A failure that is really "the tools are not installed". */
export function isToolsMissing(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return (
    /ModuleNotFoundError|No module named/i.test(reason) ||
    /\bbasic[\s_-]?pitch\b/i.test(reason) ||
    reason.includes(TOOLS_MISSING_MESSAGE)
  );
}

/** A generation error as the listener should read it. */
export function friendlyGenerateError(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return isToolsMissing(reason) ? TOOLS_MISSING_MESSAGE : reason;
}
