import 'server-only';
import { cookies } from 'next/headers';
import { UI_MODE_COOKIE, defaultUiMode, resolveUiMode, type UiMode } from '@/lib/uiMode';

/** Next's own control-flow errors (this render is dynamic, a redirect, a
 *  postpone) carry a digest or a React $$typeof: they must reach Next, as
 *  unstable_rethrow would pass them on. */
function isNextSignal(e: unknown): boolean {
  return typeof e === 'object' && e !== null && ('digest' in e || '$$typeof' in e);
}

/** This request's look (lib/uiMode), for server components: the root
 *  layout and the server route files under app/(app) that pick the new or
 *  the Classic page. Outside a request (a unit test calling a page
 *  directly) it is the default. */
export async function serverUiMode(): Promise<UiMode> {
  try {
    return resolveUiMode((await cookies()).get(UI_MODE_COOKIE)?.value);
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return defaultUiMode();
  }
}
