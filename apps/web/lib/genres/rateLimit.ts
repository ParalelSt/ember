/** One request per `intervalMs`, in call order: the pacing Last.fm (about
 *  4 a second) and MusicBrainz (1 a second, or it blocks the caller) ask
 *  for. `take()` resolves when the caller may send its request. */
export function createRateLimiter(
  perSecond: number,
  { now = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const intervalMs = 1000 / perSecond;
  let next = -Infinity;
  let chain: Promise<void> = Promise.resolve();
  function take(): Promise<void> {
    const turn = chain.then(async () => {
      const wait = next - now();
      if (wait > 0) await sleep(wait);
      next = Math.max(now(), next) + intervalMs;
    });
    chain = turn.catch(() => {});
    return turn;
  }
  return { take };
}
