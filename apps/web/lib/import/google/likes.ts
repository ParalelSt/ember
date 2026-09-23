/** A page of `videos.list?myRating=like` turned into liked songs. Pure, so
 *  the music-only rule and the title cleanup are fixture tests.
 *
 *  Google keeps one list of likes for YouTube and YouTube Music, so it holds
 *  every video a person ever liked. Music is what `categoryId` "10" says, plus
 *  anything from an auto-generated "Artist - Topic" channel (YouTube Music's
 *  own uploads, which are sometimes filed under another category). */

import type { LikedSong } from '@/lib/import/sources/ytmusicLiked';
import type { Track } from '@/types/track';

/** The fields of a YouTube Data API video resource this file reads. */
export interface YoutubeVideo {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    categoryId?: string;
    thumbnails?: Partial<Record<'default' | 'medium' | 'high' | 'standard' | 'maxres', { url?: string }>>;
  };
  contentDetails?: { duration?: string };
}

export const MUSIC_CATEGORY_ID = '10';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TOPIC_RE = /\s+-\s+Topic$/i;

/** Bits a music video title carries that the song's own name does not. */
const NOISE_RE =
  /\s*[([](?:official\s*)?(?:music\s+video|video|audio|lyric\s+video|lyrics?|visuali[sz]er|hd|4k|mv)[)\]]/gi;

/** "Artist - Title", with a hyphen, an en dash or an em dash between. */
const ARTIST_TITLE_RE = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/;

export function isMusic(video: YoutubeVideo): boolean {
  const s = video.snippet;
  return s?.categoryId === MUSIC_CATEGORY_ID || TOPIC_RE.test(s?.channelTitle ?? '');
}

/** ISO 8601 duration ("PT3M22S", "PT1H2M") in seconds; 0 when unreadable. */
export function isoSeconds(duration: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration ?? '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return d * 86_400 + h * 3_600 + min * 60 + s;
}

function artwork(video: YoutubeVideo): string | null {
  const t = video.snippet?.thumbnails ?? {};
  return t.maxres?.url ?? t.standard?.url ?? t.high?.url ?? t.medium?.url ?? t.default?.url ?? null;
}

/** The song's name and its artist. A Topic channel's title is already the
 *  song and its channel the artist; an uploaded music video is usually
 *  "Artist - Title (Official Video)" on the artist's own channel. */
export function songName(video: YoutubeVideo): { title: string; artist: string } {
  const rawTitle = (video.snippet?.title ?? '').trim();
  const channel = (video.snippet?.channelTitle ?? '').trim();
  if (TOPIC_RE.test(channel)) return { title: rawTitle, artist: channel.replace(TOPIC_RE, '').trim() };
  const title = rawTitle.replace(NOISE_RE, '').trim() || rawTitle;
  const split = ARTIST_TITLE_RE.exec(title);
  if (split) return { title: split[2].trim(), artist: split[1].trim() };
  return { title, artist: channel.replace(/VEVO$/, '').trim() || 'Unknown' };
}

/** One liked video as a liked song, or null when it is not one Ember can
 *  play (no usable video id). */
export function likedSongFromVideo(video: YoutubeVideo): LikedSong | null {
  const videoId = video.id ?? '';
  if (!VIDEO_ID_RE.test(videoId)) return null;
  const { title, artist } = songName(video);
  const track: Track = {
    id: `youtube:${videoId}`,
    sourceId: videoId,
    source: 'youtube',
    title: title || videoId,
    artist,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: isoSeconds(video.contentDetails?.duration),
    artworkUrl: artwork(video),
    streamUrl: `/api/youtube/stream/${videoId}`,
  };
  return { track, artists: [artist], likedAt: null };
}

/** Sorts one page into songs to keep and a count of what was left out.
 *  `seen` carries over between pages so a video liked twice lands once. */
export function musicFromPage(videos: YoutubeVideo[], seen: Set<string>): { songs: LikedSong[]; skipped: number } {
  const songs: LikedSong[] = [];
  let skipped = 0;
  for (const video of videos) {
    if (!isMusic(video)) {
      skipped++;
      continue;
    }
    const song = likedSongFromVideo(video);
    if (!song || seen.has(song.track.sourceId)) continue;
    seen.add(song.track.sourceId);
    songs.push(song);
  }
  return { songs, skipped };
}
