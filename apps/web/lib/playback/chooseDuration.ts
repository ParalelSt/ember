/** How long the player believes the current song is.
 *
 *  Two sources disagree. The catalog knows the real length (YouTube metadata,
 *  or a measured length for an upload) and is what every track list shows. The
 *  audio engine reports what its decoder worked out, and on the desktop that
 *  is `rodio`'s `total_duration()` over an HTTP stream, which is frequently
 *  absent and sometimes wrong.
 *
 *  The bug this fixes: duration was only ever written when the engine reported
 *  one, so a track whose engine said nothing kept the PREVIOUS song's length
 *  on the slider, and the progress bar ran against a length that was never
 *  this song's.
 *
 *  Rule: trust the catalog. Take the engine's figure only when the catalog has
 *  none, or when the two roughly agree (then the engine's is the more precise
 *  of the two, and seeking should clamp to it). */
const AGREEMENT = 0.1; // 10%

export function chooseDuration(catalogSec: number, reportedSec: number | null | undefined): number {
  const catalog = sane(catalogSec);
  const reported = sane(reportedSec);

  if (!catalog) return reported;
  if (!reported) return catalog;

  const drift = Math.abs(reported - catalog) / catalog;
  return drift <= AGREEMENT ? reported : catalog;
}

function sane(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  // A day is not a song. Guards against a decoder returning nonsense.
  return v > 24 * 3600 ? 0 : v;
}
