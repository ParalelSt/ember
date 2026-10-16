import { normalizeArtist } from '../songKey';

/** The lead artist of a credit: "Dua Lipa feat. DaBaby" -> "Dua Lipa",
 *  "Tool, Maynard" -> "Tool". "&" is left alone: it is part of too many
 *  band names ("Simon & Garfunkel"). */
export function firstArtist(name: string): string {
  return String(name ?? '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|,\s+/i)[0].trim();
}

/** The artist_genres key: the lead artist, normalized the way songKey
 *  normalizes artists (case, punctuation, " - Topic", VEVO). A name in a
 *  script that normalizes to nothing keeps its lowercased text. */
export function artistKey(name: string): string {
  const lead = firstArtist(name);
  return normalizeArtist(lead) || lead.toLowerCase();
}
