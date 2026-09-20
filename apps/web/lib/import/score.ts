/** How well a YouTube Music search result fits a source playlist track.
 *
 *  Neither Spotify nor YouTube Music exposes ISRC any more, so matching is on
 *  metadata (docs/imports.md, section 3). Each candidate gets a score from 0
 *  to 100 and a few short plain-word reasons the review screen can show.
 *
 *  | Signal                                             | Points          |
 *  |----------------------------------------------------|-----------------|
 *  | Title similarity after normalising                 | 0 to 45         |
 *  |   (a bracketed extra like "(Classic Version)" set aside: 90% of that) |
 *  | Same artist / artist name contained in the other   | +30 / +15       |
 *  | Length: 2 s or less / 6 s or less / over 15 s off   | +15 / +8 / -20  |
 *  | Explicit flag equal / differs                      | +5 / -10        |
 *  | Variant word (live, remix, ...) on one side only   | -30             |
 *  | Video type: official audio / music video / upload  | +5 / 0 / -10    |
 *
 *  75 or more is accepted, 50 to 74 needs review, under 50 is not found.
 *  Pure: no server, no Python, so the unit tests exercise it directly. */

export const ACCEPT_AT = 75;
export const REVIEW_AT = 50;

export type MatchStatus = 'accepted' | 'review' | 'missing';

export interface ScoreSource {
  title: string;
  /** Artist names. */
  artists: string[];
  /** The whole artist line, for a name that has a comma in it. */
  artist?: string;
  durationMs?: number | null;
  explicit?: boolean | null;
}

export interface ScoreCandidate {
  title: string;
  artists: string[];
  durationSec?: number | null;
  explicit?: boolean | null;
  /** `ATV`, `OMV`, `UGC`, or ytmusicapi's long form `MUSIC_VIDEO_TYPE_ATV`. */
  videoType?: string | null;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

/** Lowercase, strip accents, straighten quotes. */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u0060\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
}

const REMASTER = String.raw`(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?`;
const OFFICIAL = String.raw`official\s+(?:music\s+)?(?:audio|video|lyric\s+video|visuali[sz]er)|lyrics?(?:\s+video)?|audio|visuali[sz]er|hq|hd`;

/** Bracketed or dashed parts that never change which recording it is. */
const NOISE: RegExp[] = [
  /[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g,
  new RegExp(String.raw`[(\[]\s*(?:${REMASTER}|${OFFICIAL})\s*[)\]]`, 'g'),
  new RegExp(String.raw`\s-\s(?:${REMASTER}|${OFFICIAL})\s*$`),
  /\s(?:feat\.?|ft\.?|featuring)\s.*$/,
];

interface Variant {
  re: RegExp;
  /** How it reads when the candidate has it: "Live version". */
  label: string;
}

const VARIANTS: Variant[] = [
  { re: /\blive\b/, label: 'live version' },
  { re: /\bremix\w*/, label: 'remix' },
  { re: /\bacoustic\b/, label: 'acoustic version' },
  { re: /\bcover\b/, label: 'cover' },
  { re: /\bkaraoke\b/, label: 'karaoke version' },
  { re: /\bsped[\s-]*up\b/, label: 'sped up version' },
  { re: /\bslowed(?:\s*(?:\+|and)?\s*reverb)?\b/, label: 'slowed version' },
  { re: /\binstrumental\b/, label: 'instrumental' },
  { re: /\bnightcore\b/, label: 'nightcore version' },
  { re: /\bdemo\b/, label: 'demo' },
  { re: /\bextended\b/, label: 'extended version' },
  { re: /\bradio\s*edit\b/, label: 'radio edit' },
  { re: /\bclean\b/, label: 'clean version' },
  { re: /\bcensored\b/, label: 'censored version' },
];

/** The title with case, accents, "feat. X", "(Official Audio)" and
 *  "Remastered 2011" removed. Variant words stay: they are scored apart. */
export function normalizeTitle(title: string): string {
  let s = fold(title);
  for (const re of NOISE) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Letters and digits only, for comparing. */
function flat(s: string): string {
  return s
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The title with variant words (and the bracket or dash part around them)
 *  taken out, so "Song (Live at Wembley)" compares as "Song" and the variant
 *  penalty is the only thing that counts it. */
function coreTitle(normalized: string): string {
  let s = normalized;
  for (const v of VARIANTS) {
    const any = v.re.source;
    s = s
      .replace(new RegExp(String.raw`[(\[][^)\]]*${any}[^)\]]*[)\]]`, 'g'), ' ')
      .replace(new RegExp(String.raw`\s-\s[^-]*${any}.*$`), ' ')
      .replace(new RegExp(any, 'g'), ' ');
  }
  return flat(s);
}

function dropBrackets(normalized: string): string {
  return normalized.replace(/[([][^)\]]*[)\]]/g, ' ');
}

function variantsOf(normalized: string): Set<string> {
  return new Set(VARIANTS.filter((v) => v.re.test(normalized)).map((v) => v.label));
}

/** The sorted, joined labels of every version marker (instrumental, live,
 *  remix, acoustic, karaoke, sped up, slowed, cover, demo, extended, radio
 *  edit, clean/censored, ...) found in `title` — empty string when there are
 *  none. Two titles with different marker sets must never collapse to one
 *  song identity, even when they're otherwise the same song; two titles that
 *  differ only by punctuation, "feat." spelling, or noise words like
 *  "(Official Video)" must produce the same markers (usually none) and so
 *  stay collapsible. This is the one shared source of variant words — reused
 *  by score() above (as a scoring penalty) and by songKey() (as part of the
 *  identity key), so a new marker only needs to be added here once. */
export function variantMarkers(title: string): string {
  return [...variantsOf(normalizeTitle(title))].sort().join('+');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient on character pairs, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

export function normalizeArtist(name: string): string {
  return flat(fold(name).replace(/\s-\s*topic$/, '').replace(/\s*vevo$/, ''));
}

function formatSeconds(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

function shortVideoType(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.replace(/^MUSIC_VIDEO_TYPE_/, '').toUpperCase();
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function score(source: ScoreSource, cand: ScoreCandidate): ScoreResult {
  const reasons: string[] = [];
  let points = 0;

  // Title, 0 to 45.
  const srcNorm = normalizeTitle(source.title);
  const candNorm = normalizeTitle(cand.title);
  // A bracketed descriptor that is not a variant ("(Classic Version)", "(From
  // the Movie)") still counts, but a match with it set aside is worth 90%.
  const sim = Math.max(
    titleSimilarity(coreTitle(srcNorm), coreTitle(candNorm)),
    0.9 * titleSimilarity(coreTitle(dropBrackets(srcNorm)), coreTitle(dropBrackets(candNorm))),
  );
  points += Math.round(45 * sim);
  if (sim === 1) reasons.push('Same title');
  else if (sim >= 0.8) reasons.push('Similar title');
  else reasons.push('Different title');

  // Artist, +30 or +15.
  const want = [...source.artists, ...(source.artist ? [source.artist] : [])].map(normalizeArtist).filter(Boolean);
  const have = cand.artists.map(normalizeArtist).filter(Boolean);
  if (want.length && have.length) {
    if (want.some((w) => have.includes(w))) {
      points += 30;
      reasons.push('Same artist');
    } else if (
      want.some((w) => have.some((h) => Math.min(w.length, h.length) >= 3 && (w.includes(h) || h.includes(w))))
    ) {
      points += 15;
      reasons.push('Similar artist name');
    } else {
      reasons.push('Different artist');
    }
  }

  // Length.
  if (source.durationMs && cand.durationSec) {
    const delta = Math.abs(cand.durationSec - source.durationMs / 1000);
    if (delta <= 2) {
      points += 15;
      reasons.push('Length matches');
    } else if (delta <= 6) {
      points += 8;
      reasons.push('Length close');
    } else if (delta > 15) {
      points -= 20;
      reasons.push(`Length off by ${formatSeconds(delta)}`);
    } else {
      reasons.push(`Length off by ${formatSeconds(delta)}`);
    }
  }

  // Explicit flag.
  if (typeof source.explicit === 'boolean' && typeof cand.explicit === 'boolean') {
    if (source.explicit === cand.explicit) points += 5;
    else {
      points -= 10;
      reasons.push(cand.explicit ? 'Explicit version' : 'Clean version');
    }
  }

  // Variant words on one side only.
  const srcVariants = variantsOf(srcNorm);
  const candVariants = variantsOf(candNorm);
  const extra = [...candVariants].filter((v) => !srcVariants.has(v));
  const missing = [...srcVariants].filter((v) => !candVariants.has(v));
  if (extra.length || missing.length) {
    points -= 30;
    for (const v of extra) reasons.push(capitalize(v));
    for (const v of missing) reasons.push(`Not the ${v}`);
  }

  // Video type.
  const type = shortVideoType(cand.videoType);
  if (type === 'ATV') {
    points += 5;
    reasons.push('Official audio');
  } else if (type === 'OMV') {
    reasons.push('Music video');
  } else if (type === 'UGC') {
    points -= 10;
    reasons.push('Fan upload');
  }

  return { score: Math.max(0, Math.min(100, points)), reasons };
}

export function statusFor(best: number | null | undefined): MatchStatus {
  if (best == null) return 'missing';
  if (best >= ACCEPT_AT) return 'accepted';
  if (best >= REVIEW_AT) return 'review';
  return 'missing';
}

/** Score every candidate and sort best first (ties keep search order). */
export function rankCandidates<C extends ScoreCandidate>(
  source: ScoreSource,
  candidates: C[],
): (C & ScoreResult)[] {
  return candidates
    .map((c) => ({ ...c, ...score(source, c) }))
    .sort((a, b) => b.score - a.score);
}
