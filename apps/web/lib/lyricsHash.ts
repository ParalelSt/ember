export interface LyricsLineLike {
  time: number;
  text: string;
}

/** Deterministic 8-char hash of a LRC line array, derived only from
 *  timestamps (rounded to 2 decimal places). Used by the offset cache
 *  to detect when the matched LRC has changed and the cached offset
 *  no longer applies. Not cryptographic — DJB-style 32-bit hash. */
export function hashLrc(lines: LyricsLineLike[]): string {
  const sig = lines.map((l) => l.time.toFixed(2)).join(',');
  let h = 0;
  for (let i = 0; i < sig.length; i++) {
    h = ((h << 5) - h + sig.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).padStart(8, '0').slice(0, 8);
}
