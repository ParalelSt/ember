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

/** A shuffle that is never the order `previous` (song ids) already is: a
 *  press that changed nothing would look like the button did nothing. Drawn
 *  again a few times, then rotated by one, so a list of two or more always
 *  comes out different (unless every song is the same one). */
export function shuffleFresh<T extends { id: string }>(
  list: readonly T[],
  previous: readonly string[] | null,
  rng: () => number = Math.random,
): T[] {
  const same = (l: readonly T[]) => !!previous && l.length === previous.length && l.every((s, k) => s.id === previous[k]);
  let out = shuffle(list, rng);
  for (let n = 0; n < 8 && list.length > 1 && same(out); n++) out = shuffle(list, rng);
  if (list.length > 1 && same(out) && list.some((s) => s.id !== list[0].id)) out = [...out.slice(1), out[0]];
  return out;
}
