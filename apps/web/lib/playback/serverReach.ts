import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { GATEWAY_STATUSES, connectionOk, whenConnectionBack } from '@/lib/connectionBlip';

/** The server could not be reached while the browser still says it is
 *  online.
 *
 *  A weak mobile signal (a tunnel, a dead zone) leaves `navigator.onLine`
 *  true while nothing gets through, so the player's offline rules, which
 *  read `useAutoCacheStore.online`, never ran: the song that would not load
 *  stopped with "Couldn't load it, tap to retry" while the songs already on
 *  the device sat unplayed. The Android app's player has the same rule
 *  natively (ConnectionHealth.kt).
 *
 *  `serverUnreachable()` puts the player offline, and watches for the
 *  server: any answer to an api call (connectionBlip), or two in a row to a
 *  small request of its own every PROBE_MS (not a sign-in page's), puts it
 *  back online, which the player handles as the connection returning. */

export const PROBE_MS = 10_000;
/** A small static file on the Ember server, the native probe's too. */
export const PROBE_PATH = '/favicon-16.png';

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

let watching = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function answers(): Promise<boolean> {
  // A request on a dead connection (a phone that changed networks) can wait
  // for minutes before it fails, and the watch waited with it: the player
  // stayed offline long after the server was back. A probe gets PROBE_MS.
  const ctl = new AbortController();
  const limit = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    const res = await fetch(`${BASE}${PROBE_PATH}`, { method: 'HEAD', cache: 'no-store', credentials: 'include', signal: ctl.signal });
    // A static file never gets these from Ember: a gateway answered for it.
    if (GATEWAY_STATUSES.includes(res.status)) return false;
    // Nor a redirect to a page: a Wi-Fi sign-in page answering in its place.
    return !res.redirected && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  } finally {
    clearTimeout(limit);
  }
}

function back(): void {
  if (!watching) return;
  watching = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const store = useAutoCacheStore.getState();
  if (!store.online) store.setOnline(true);
}

/** Probe answers in a row so far. One is not enough: a link that lets a
 *  single request through between failures flipped the player online, the
 *  next song failed, and it went offline again. */
let answersInARow = 0;
const ANSWERS_TO_COME_BACK = 2;

function lookLater(): void {
  timer = setTimeout(() => {
    timer = null;
    void answers().then((ok) => {
      if (!watching) return;
      answersInARow = ok ? answersInARow + 1 : 0;
      // Answers that hold are the connection back, for whatever else waits
      // on it.
      if (answersInARow >= ANSWERS_TO_COME_BACK) connectionOk();
      else lookLater();
    });
  }, PROBE_MS);
}

/** No HTTP answer from the server at all: the player goes offline until
 *  the server answers again. Calling it again while watching does nothing
 *  more. */
export function serverUnreachable(): void {
  const store = useAutoCacheStore.getState();
  if (store.online) store.setOnline(false);
  if (watching) return;
  watching = true;
  answersInARow = 0;
  whenConnectionBack(back);
  lookLater();
}

/** True while waiting for the server to answer again. */
export function waitingForServer(): boolean {
  return watching;
}

/** Tests only: module state. */
export function resetServerReach(): void {
  watching = false;
  answersInARow = 0;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
