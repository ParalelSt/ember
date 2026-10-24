import 'server-only';
import type { RecordModel } from 'pocketbase';
import { radioService } from '@/lib/radio/service';
import { isStationId, stationTrack, type RadioStation } from '@/lib/radio/station';

/** Most favourites a member may keep. */
export const MAX_FAVORITES = 200;

/** A favourites row as a station: what Radio Browser said when it was added,
 *  or, when the server has the station in memory from a recent list, that
 *  fresher copy. */
export function favoriteStation(row: RecordModel): RadioStation | null {
  const id = String(row.station_id ?? '').toLowerCase();
  if (!isStationId(id)) return null;
  const fresh = radioService().peek(id);
  if (fresh) return fresh;
  const favicon = typeof row.favicon === 'string' && row.favicon.startsWith('https:') ? row.favicon : null;
  const base = {
    id,
    name: String(row.name ?? '') || 'Radio station',
    favicon,
    country: '',
    countryCode: '',
    state: '',
    codec: '',
    bitrate: 0,
    votes: 0,
    distanceKm: null,
  };
  return { ...base, track: stationTrack(base) };
}
