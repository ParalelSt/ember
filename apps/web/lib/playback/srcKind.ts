import { isStationStreamUrl } from '@/lib/radio/station';

/** What a media src is, for the log line of an audio failure: an
 *  automatic report that says only "MEDIA_ELEMENT_ERROR: Format error"
 *  cannot tell a dead radio station from a song that will not decode.
 *  - station: a live station's proxy stream (its outage, not Ember's)
 *  - youtube / upload: the host's stream of a song
 *  - cached: a copy in browser storage (a blob: URL)
 *  - local: a file on the device (an Android download, a desktop asset)
 *  - none: no src at all (already dropped, or never set) */
export type MediaSrcKind = 'station' | 'youtube' | 'upload' | 'cached' | 'local' | 'other' | 'none';

export function mediaSrcKind(src: string | null | undefined): MediaSrcKind {
  if (!src) return 'none';
  if (isStationStreamUrl(src)) return 'station';
  if (src.startsWith('blob:')) return 'cached';
  if (/^(file|capacitor|asset):|\/_capacitor_file_\/|^https?:\/\/asset\.localhost\//.test(src)) return 'local';
  if (/\/api\/youtube\/stream\/[^/?#]+/.test(src)) return 'youtube';
  if (/\/api\/uploads\/[^/?#]+\/stream/.test(src)) return 'upload';
  return 'other';
}
