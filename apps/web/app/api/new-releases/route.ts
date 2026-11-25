import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { artistKey } from '@/lib/genres/artistKey';
import { genreTagger } from '@/lib/genres/instance';
import { pbQuote } from '@/lib/genres/store';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { buildRow, likedArtists, memberFamilies, playStats, type LikeRow, type PlayRow } from '@/lib/newReleases/rules';
import { newReleasesCache } from '@/lib/newReleases/instance';
import type { NewReleasesPayload } from '@/lib/newReleasesView';
import { fromError } from '@/lib/upsertTrack';

/** The "New releases" row for Home (docs/new-releases-plan.md): the shared
 *  ledger, chosen for the signed-in member from their own likes. It only
 *  reads: the cache answers at once and may start its own background run, so
 *  a page load never waits on a scan. A source that is down gives an empty or
 *  stale list, never an error. */
interface LikeRecord {
  liked_at?: string;
  created?: string;
  expand?: { track?: { source?: string; artist?: string; artist_id?: string } };
}

interface PlayRecord {
  played_at?: string;
  expand?: { track?: { source?: string; artist?: string; artist_id?: string } };
}

const PLAYS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const toPlayRow = (r: PlayRecord): PlayRow => ({
  source: r.expand?.track?.source ?? '',
  artistId: r.expand?.track?.artist_id || null,
  artist: r.expand?.track?.artist ?? '',
  playedAt: r.played_at ?? '',
});

const toLikeRow = (r: LikeRecord): LikeRow => {
  const t = r.expand?.track;
  return {
    source: t?.source ?? '',
    artistId: t?.artist_id || null,
    artist: t?.artist ?? '',
    likedAt: r.liked_at || null,
    created: r.created ?? '',
  };
};

const empty = (): NewReleasesPayload => ({ releases: [], refreshedAt: null, stale: false });

export const GET = withRequestLog('new-releases', async () => {
  try {
    const { pb, user } = await requireUser();
    if (process.env.NEW_RELEASES_DISABLED === '1') return Response.json(empty());

    const since = new Date(Date.now() - PLAYS_WINDOW_MS).toISOString().replace('T', ' ');
    const [ledger, rows, playRecords] = await Promise.all([
      newReleasesCache().get(),
      pb.collection('likes').getFullList<LikeRecord>({
        filter: `user = ${pbQuote(user.id)}`,
        expand: 'track',
        fields: 'liked_at,created,expand.track.source,expand.track.artist,expand.track.artist_id',
        batch: 500,
      }),
      // Read-only, this member's own plays of the last month: they only
      // weigh the draw and never leave the server.
      pb.collection('plays').getFullList<PlayRecord>({
        filter: `user = ${pbQuote(user.id)} && played_at >= "${since}"`,
        expand: 'track',
        fields: 'played_at,expand.track.source,expand.track.artist,expand.track.artist_id',
        batch: 500,
      }),
    ]);
    const plays = playRecords.map(toPlayRow);
    // Liked or played: an artist the member only listened to counts too.
    const liked = likedArtists([
      ...rows.map(toLikeRow),
      ...plays.map((p): LikeRow => ({ source: p.source, artistId: p.artistId, artist: p.artist, likedAt: p.playedAt, created: p.playedAt })),
    ]);
    // Reads rows only: maxLookups 0 never reaches Last.fm or MusicBrainz.
    const tags = liked.length ? await genreTagger().ensureTags(liked.map((a) => ({ name: a.name, artistId: a.artistId })), { maxLookups: 0 }) : new Map();
    const families = memberFamilies(liked, (a) => tags.get(artistKey(a.name))?.family ?? null);
    const body: NewReleasesPayload = {
      releases: buildRow({ releases: ledger.releases, recent: ledger.recent, liked, plays: playStats(plays, Date.now()), families, now: Date.now() }),
      refreshedAt: ledger.refreshedAt,
      stale: ledger.stale,
    };
    return Response.json(body);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
