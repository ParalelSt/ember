/** Upper bounds (ms) of the fixed buckets. Each is about 1.6 times the one
 *  before, so a median read from them is within that factor of the truth,
 *  which is plenty to tell 200 ms from 2 s. */
export const BUCKETS_MS = [
  10, 16, 25, 40, 60, 100, 160, 250, 400, 600, 1000, 1600, 2500, 4000, 6000, 10_000, 16_000, 25_000, 40_000, 60_000,
] as const;

/** Count, total, max and a fixed bucket count for one stream of durations.
 *  Constant size: 21 numbers whatever is added. */
export class Histogram {
  readonly counts = new Array<number>(BUCKETS_MS.length + 1).fill(0);
  count = 0;
  sum = 0;
  max = 0;

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    let i = 0;
    while (i < BUCKETS_MS.length && ms > BUCKETS_MS[i]) i++;
    this.counts[i]++;
    this.count++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
  }

  /** The bucket bound the q-th quantile falls in, never above the real max. */
  quantile(q: number): number {
    if (this.count === 0) return 0;
    const rank = Math.max(1, Math.ceil(q * this.count));
    let seen = 0;
    for (let i = 0; i < this.counts.length; i++) {
      seen += this.counts[i];
      if (seen >= rank) return Math.min(i < BUCKETS_MS.length ? BUCKETS_MS[i] : this.max, this.max);
    }
    return this.max;
  }

  reset(): void {
    this.counts.fill(0);
    this.count = 0;
    this.sum = 0;
    this.max = 0;
  }
}

/** Exact quantile of a small list of numbers (sorted copy). */
export function quantileOf(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}
