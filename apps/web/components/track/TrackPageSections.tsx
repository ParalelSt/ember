'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronRightIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { SectionHeader } from '@/components/page/SectionHeader';
import { AlbumShelf } from '@/components/artist/AlbumShelf';
import { TrackList } from '@/components/track/TrackList';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { SongLyricsSheet, lyricLines } from '@/components/track/SongLyricsSheet';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useQueryLyrics } from '@/hooks/useLyrics';
import { useQueryAlbum, useQueryArtist, useQueryRecommended } from '@/hooks/useLibrary';
import { pickThumbnail } from '@/lib/artwork';
import { exclusionKeys, isExcluded } from '@/lib/trackIdentity';
import { cn } from '@/lib/utils';
import type { AlbumDetail, AlbumSummary, ArtistPayload, Track } from '@/types/track';

/** How many lyric lines the preview card shows. */
export const LYRICS_PREVIEW_LINES = 3;
/** How many similar songs the list holds. */
export const SIMILAR_MAX = 10;

/** The bordered card the song page's blocks share (the owner's "The works"). */
const CARD = 'rounded-2xl border border-border bg-card p-block transition-colors hover:border-foreground/20';

/** Everything under the song page's header and action row (the owner's
 *  "The works" pick), top to bottom: a lyrics preview, the artist and
 *  album cards, More by the artist, Similar songs. Each block hides when
 *  it has nothing to show and says nothing while it loads. */
export function TrackPageSections({ track }: { track: Track }) {
  const { data: artist } = useQueryArtist(track.artistId ?? '');
  const { data: album } = useQueryAlbum(track.albumId);
  return (
    <div className="flex flex-col gap-section" data-testid="track-sections">
      <LyricsSection track={track} />
      <AboutCards track={track} artist={artist} album={album} />
      <MoreBy track={track} artist={artist} />
      <SimilarSongs track={track} />
    </div>
  );
}

function LyricsSection({ track }: { track: Track }) {
  const { data } = useQueryLyrics(track, true);
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const lines = lyricLines(data);
  if (!data || lines.length === 0) return null;
  const preview = lines.slice(0, LYRICS_PREVIEW_LINES);
  return (
    <section aria-label="Lyrics">
      <SectionHeader
        title="Lyrics"
        className="mb-block items-center"
        action={
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Open lyrics">
            Open
            <ChevronRightIcon className="size-3.5" />
          </Button>
        }
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="lyrics-preview"
        className={cn(CARD, 'flex w-full flex-col gap-inset text-left')}
      >
        {preview.map((line, i) => (
          <span
            key={i}
            data-testid="lyrics-preview-line"
            className={cn(
              'block text-[15px] leading-normal',
              i === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {line}
          </span>
        ))}
        <span className="mt-inset block text-xs text-muted-foreground/70">Tap for the whole song</span>
      </button>
      <SongLyricsSheet
        track={track}
        lyrics={data}
        open={open}
        onOpenChange={setOpen}
        side={isDesktop ? 'right' : 'bottom'}
      />
    </section>
  );
}

/** "11 songs · 2024", leaving out what the album data lacks. */
export function albumStat(album: AlbumDetail | undefined): string {
  if (!album) return '';
  const parts: string[] = [];
  if (album.trackCount) parts.push(`${album.trackCount} ${album.trackCount === 1 ? 'song' : 'songs'}`);
  if (album.year) parts.push(String(album.year));
  return parts.join(' · ');
}

function InfoCard({
  href,
  eyebrow,
  name,
  stat,
  art,
  testId,
}: {
  href: string;
  eyebrow: string;
  name: string;
  stat?: string;
  art: ReactNode;
  testId: string;
}) {
  return (
    <Link href={href} data-testid={testId} className={cn(CARD, 'flex min-w-0 items-center gap-block')}>
      {art}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-eyebrow font-semibold">{eyebrow}</span>
        <span className="truncate text-[17px] font-bold tracking-tight text-foreground">{name}</span>
        {stat ? <span className="mt-inset truncate text-xs text-muted-foreground">{stat}</span> : null}
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** The artist's and the album's cards: side by side from md up, stacked on
 *  a phone; the artist's alone takes the whole width. No stat line on the
 *  artist: YouTube Music's artist answer carries no listener or subscriber
 *  count, and a made-up one is worse than none. */
function AboutCards({ track, artist, album }: { track: Track; artist?: ArtistPayload; album?: AlbumDetail }) {
  const albumName = album?.title || track.album;
  const showArtist = !!track.artistId;
  const showAlbum = !!track.albumId && !!albumName;
  if (!showArtist && !showAlbum) return null;
  return (
    <section aria-label="Artist and album" className={cn('grid grid-cols-1 gap-block', showArtist && showAlbum && 'md:grid-cols-2')}>
      {showArtist && (
        <InfoCard
          testId="artist-card"
          href={`/artist/${track.artistId}`}
          eyebrow="Artist"
          name={artist?.name || track.artist}
          art={
            <Artwork
              src={pickThumbnail(artist?.thumbnails)}
              shape="round"
              fallback="gradient"
              className="size-18 shrink-0"
            />
          }
        />
      )}
      {showAlbum && (
        <InfoCard
          testId="album-card"
          href={`/album/${encodeURIComponent(track.albumId!)}`}
          eyebrow="Album"
          name={albumName!}
          stat={albumStat(album)}
          art={
            <Artwork
              src={pickThumbnail(album?.thumbnails) ?? track.artworkUrl}
              fallback="gradient"
              className="size-18 shrink-0 rounded-lg"
            />
          }
        />
      )}
    </section>
  );
}

/** The artist's albums then singles, without the one this song is on (by
 *  id, or by name when the ids are spelled differently). */
export function otherReleases(track: Pick<Track, 'album' | 'albumId'>, artist: ArtistPayload | undefined): AlbumSummary[] {
  if (!artist) return [];
  const ownTitle = track.album?.trim().toLowerCase();
  const seen = new Set<string>();
  return [...(artist.albums ?? []), ...(artist.singles ?? [])].filter((a) => {
    if (seen.has(a.browseId)) return false;
    seen.add(a.browseId);
    if (track.albumId && a.browseId === track.albumId) return false;
    if (ownTitle && a.title.trim().toLowerCase() === ownTitle) return false;
    return true;
  });
}

function MoreBy({ track, artist }: { track: Track; artist?: ArtistPayload }) {
  const releases = otherReleases(track, artist);
  if (releases.length === 0) return null;
  return <AlbumShelf title={`More by ${artist?.name || track.artist}`} albums={releases} className="mb-0" />;
}

/** Radio's picks seeded by this song, the song itself (any spelling of it)
 *  left out, at most SIMILAR_MAX. */
export function similarTo(track: Track, recs: readonly Track[] | undefined): Track[] {
  if (!recs?.length) return [];
  const own = new Set(exclusionKeys([track]));
  return recs.filter((t) => !isExcluded(t, own)).slice(0, SIMILAR_MAX);
}

function SimilarSongs({ track }: { track: Track }) {
  const trackActions = useTrackActions();
  // Radio grows from a YouTube video: any other id is no seed (the server
  // would answer it with today's chart).
  const { data } = useQueryRecommended(track.source === 'youtube' ? track.sourceId : undefined);
  const similar = similarTo(track, data);
  if (similar.length === 0) return null;
  return (
    <section aria-label="Similar songs">
      <SectionHeader title="Similar songs" className="mb-block" />
      <TrackList tracks={similar} trailing={renderTrackMenu} {...trackActions} />
    </section>
  );
}
