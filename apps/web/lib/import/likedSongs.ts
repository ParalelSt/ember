import 'server-only';
import type PocketBase from 'pocketbase';
import { likedIndex, type LikedIndex } from '@/lib/import/alreadyLiked';

/** The person's likes as an index to look a transfer's songs up in
 *  (lib/import/alreadyLiked.ts): each like's track title, artist and
 *  YouTube video. */
export async function likedIndexFor(pb: PocketBase, userId: string): Promise<LikedIndex> {
  const records = await pb.collection('likes').getFullList({
    filter: pb.filter('user = {:user}', { user: userId }),
    expand: 'track',
    fields: 'expand.track.title,expand.track.artist,expand.track.source,expand.track.source_id',
  });
  return likedIndex(
    records.flatMap((r) => {
      const t = (r.expand as { track?: { title?: string; artist?: string; source?: string; source_id?: string } } | undefined)
        ?.track;
      if (!t?.title) return [];
      return [{ title: t.title, artist: t.artist ?? '', videoId: t.source === 'youtube' ? t.source_id || null : null }];
    }),
  );
}
