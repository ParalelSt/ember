/** A page of `videos.list?myRating=like` turned into liked songs. Pure, so
 *  the first music filter and the title cleanup are fixture tests.
 *
 *  Google keeps one list of likes for YouTube and YouTube Music, so it holds
 *  every video a person ever liked. The first pass, here, costs nothing:
 *  keep what `categoryId` "10" says is music, plus anything from an
 *  auto-generated "Artist - Topic" channel (YouTube Music's own uploads,
 *  which are sometimes filed under another category). That drops most of a
 *  person's likes at once. It is only the uploader's word, though (the
 *  owner's Minecraft video said "Music"), so the survivors go through a
 *  second pass before the preview: YouTube Music itself says which are
 *  songs (lib/import/musicCheck.ts). A Topic channel needs no asking. */

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

/** From an auto-generated Topic channel: official audio, a song for sure. */
export function isTopic(video: YoutubeVideo): boolean {
  return TOPIC_RE.test(video.snippet?.channelTitle ?? '');
}

/** The first pass: what the uploader filed under Music, or a Topic channel. */
export function isMusic(video: YoutubeVideo): boolean {
  return video.snippet?.categoryId === MUSIC_CATEGORY_ID || isTopic(video);
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
  // A Topic channel is YouTube Music's own official audio (ATV) already;
  // anything else waits for YouTube Music to say (null).
  return { track, artists: [artist], likedAt: null, videoType: isTopic(video) ? 'ATV' : null };
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
