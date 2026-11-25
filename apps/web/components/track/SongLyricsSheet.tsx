'use client';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

/** What the sheet needs of a lyrics answer (the shape of useLyrics'
 *  result). */
export interface SongLyrics {
  lyrics: string | null;
  source: string;
  url: string | null;
  synced?: { time: number; text: string }[];
}

/** A Genius section marker ("[Chorus]") is not a line anyone sings. */
const SECTION_MARKER = /^\[.*\]$/;

/** The sung lines of a lyrics answer, in order: the synced lines when
 *  there are any, else the plain text split into lines. Blank lines and
 *  section markers are left out. */
export function lyricLines(result: SongLyrics | null | undefined): string[] {
  if (!result) return [];
  const raw = result.synced && result.synced.length > 0
    ? result.synced.map((l) => l.text)
    : (result.lyrics ?? '').split(/\r?\n/);
  return raw.map((l) => l.trim()).filter((l) => l && !SECTION_MARKER.test(l));
}

/** The whole text of a song's lyrics, verses kept apart: the plain lyrics
 *  when the answer has them, else the synced lines one per line. */
function fullText(result: SongLyrics): string {
  if (result.lyrics?.trim()) return result.lyrics.trim();
  return lyricLines(result).join('\n');
}

/** The whole lyrics of one song, the song page's (not the playing one, so
 *  not the player's lyrics view, which follows the player). A sheet up from
 *  the bottom on a phone, from the right on desktop, plain text that
 *  scrolls. */
export function SongLyricsSheet({
  track,
  lyrics,
  open,
  onOpenChange,
  side,
}: {
  track: Track;
  lyrics: SongLyrics;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'bottom' on a phone, 'right' on desktop. */
  side: 'bottom' | 'right';
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-testid="song-lyrics-sheet"
        className={cn(
          'gap-0',
          side === 'bottom'
            ? 'max-h-[85svh] rounded-t-2xl'
            : 'data-[side=right]:w-[min(420px,100vw)] data-[side=right]:sm:max-w-none',
        )}
      >
        <div className="flex flex-col gap-inset px-block pt-block pb-row pr-section">
          <SheetTitle className="text-base font-semibold">Lyrics</SheetTitle>
          <SheetDescription className="truncate">
            {track.title} · {track.artist}
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-block pb-stack">
          <p className="whitespace-pre-wrap text-xl font-bold leading-snug text-foreground">{fullText(lyrics)}</p>
          {lyrics.source === 'genius' && lyrics.url ? (
            <a
              href={lyrics.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-stack inline-block text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Source: Genius
            </a>
          ) : lyrics.source === 'lrclib' ? (
            <div className="mt-stack text-[10px] uppercase tracking-widest text-muted-foreground">From LRCLib</div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
