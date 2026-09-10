/** Fisher-Yates shuffle. Returns a new array; never mutates `list`. The rng
 *  is injectable so callers (and tests) can get a deterministic order. */
export function shuffle<T>(list: readonly T[], rng: () => number = Math.random): T[] {
  const result = list.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
