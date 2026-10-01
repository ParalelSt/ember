'use client';

import { Artwork } from '@/components/primitives/Artwork';
import { WarningIcon } from '@/components/icons';
import { shortReason } from '@/lib/playback/unplayableBar';
import type { UnplayableNotice } from '@/lib/playback/unplayable';
import type { Track } from '@/types/track';

export interface CouldntPlayEntry {
  track: Track;
  notice: UnplayableNotice;
}

/** The songs this session could not play that are still in the queue, oldest
 *  first, without the one playing (it has its own row under "Now playing"). */
export function couldntPlayEntries(
  notices: readonly UnplayableNotice[],
  queue: readonly Track[],
  currentId: string | null,
): CouldntPlayEntry[] {
  const out: CouldntPlayEntry[] = [];
  for (const notice of notices) {
    if (notice.trackId === currentId) continue;
    const track = queue.find((t) => t.id === notice.trackId);
    if (track) out.push({ track, notice });
  }
  return out;
}

/** "Removed from YouTube · Skipped": why, then what the player did. */
export function couldntPlayNote({ track, notice }: CouldntPlayEntry): string {
  const why = shortReason({ kind: notice.kind, reason: notice.reason ?? track.unavailableReason ?? null });
  const did = notice.outcome === 'skipped' ? 'Skipped' : 'Stopped';
  return `${why} · ${did}`;
}

/** The queue sheet's "Couldn't play · N" section (the owner's pick, option
 *  A's queue): the queue starts at the song playing, so a song skipped on
 *  the way there would otherwise be out of sight. Greyed artwork and title,
 *  a small warning and the reason. Nothing to tap: the songs are gone or
 *  would not load, and the bar has already said so. */
export function CouldntPlaySection({
  entries,
  artworkSrcFor,
  labelClassName,
}: {
  entries: CouldntPlayEntry[];
  artworkSrcFor: (track: Track) => string | null;
  /** The sheet's own section label style, so the three headings match. */
  labelClassName: string;
}) {
  if (!entries.length) return null;
  return (
    <section data-testid="couldnt-play" aria-label="Couldn't play">
      <div className={labelClassName}>Couldn&apos;t play · {entries.length}</div>
      <ul className="flex flex-col">
        {entries.map((e) => (
          <li
            key={e.track.id}
            data-testid="couldnt-play-row"
            className="flex items-center gap-row rounded-md px-row py-cluster"
          >
            <Artwork src={artworkSrcFor(e.track)} size="xs" className="shrink-0 rounded bg-art opacity-40 grayscale" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-sidebar-foreground/60">{e.track.title}</span>
              <span className="flex min-w-0 items-center gap-inset text-xs text-sidebar-foreground/55">
                <WarningIcon aria-hidden className="size-3 shrink-0 text-ember" />
                <span data-testid="couldnt-play-note" className="truncate">{couldntPlayNote(e)}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
