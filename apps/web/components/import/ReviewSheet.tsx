'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Artwork } from '@/components/primitives/Artwork';
import { AlertIcon, CheckIcon, CloseIcon, MusicIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { CandidateRow, Kbd, SOURCE_NAME } from '@/components/import/parts';
import { formatTime } from '@/lib/format';
import { reviewFlag } from '@/lib/import/reasons';
import type { ImportItem, ImportSourceKind } from '@/lib/import/types';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

/** How many candidates the sheet shows up front: one per number key. */
export const SHEET_KEYS = 3;
/** Above this many songs the header shows a bar instead of one pip each. */
const MAX_PIPS = 12;

export interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  /** 'review' walks the queue; 'rematch' is one accepted song picked again. */
  mode: 'review' | 'rematch';
  playlistName: string;
  source: ImportSourceKind;
  queue: ImportItem[];
  /** Position in `queue`; past the end is the "all done" state. */
  index: number;
  busy?: boolean;
  /** The track the player is previewing, and whether it is playing. */
  previewId: string | null;
  previewPlaying: boolean;
  onPreview: (track: Track) => void;
  onPick: (item: ImportItem, track: Track) => void;
  onSkip: () => void;
  onRemove: (item: ImportItem) => void;
  /** Manual search ("none of these"). */
  searchResults: Track[] | null;
  searching: boolean;
  onSearch: (query: string) => void;
}

/** The source song as the source playlist has it: what every candidate is
 *  judged against. */
function SourceCard({ item, source }: { item: ImportItem; source: ImportSourceKind }) {
  const flag = reviewFlag(item);
  const s = item.source;
  return (
    <div data-testid="review-source" className="rounded-lg border border-border bg-card p-row md:p-block">
      <div className="flex items-center justify-between gap-cluster">
        <div className="text-eyebrow">On {SOURCE_NAME[source]}</div>
        <div className="text-xs tabular-nums text-muted-foreground">#{item.position + 1}</div>
      </div>
      <div className="mt-inset truncate text-base font-bold tracking-tight md:mt-cluster md:text-lg">{s.title}</div>
      <div className="truncate text-meta">
        {s.artist}
        {s.durationMs ? ` · ${formatTime(s.durationMs / 1000)}` : ''}
        {s.explicit ? ' · Explicit' : ''}
      </div>
      {flag && (
        <div className="mt-cluster flex items-center gap-cluster text-xs text-ember">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {flag}
        </div>
      )}
    </div>
  );
}

/** "None of these": search YouTube Music and use any result. */
function SearchPanel({
  initial,
  results,
  searching,
  busy,
  onSearch,
  onUse,
}: {
  initial: string;
  results: Track[] | null;
  searching: boolean;
  busy: boolean;
  onSearch: (q: string) => void;
  onUse: (t: Track) => void;
}) {
  const [q, setQ] = useState(initial);
  return (
    <div data-testid="review-search" className="flex flex-col gap-cluster">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onSearch(q.trim());
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          aria-label="Search YouTube Music"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search YouTube for another version"
          className="h-8 pl-9"
        />
      </form>
      {searching && <div className="text-xs text-muted-foreground">Searching…</div>}
      {results && !searching && results.length === 0 && <div className="text-xs text-muted-foreground">Nothing found.</div>}
      {results && !searching && results.length > 0 && (
        <div className="-mx-cluster flex flex-col">
          {results.slice(0, 8).map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() => onUse(t)}
              data-testid="review-search-result"
              className="flex items-center gap-row rounded-md px-cluster py-inset text-left transition-colors hover:bg-card disabled:opacity-60"
            >
              <Artwork src={t.artworkUrl} size="xs" className="grid shrink-0 place-items-center rounded bg-art text-foreground/20">
                <MusicIcon className="h-4 w-4" />
              </Artwork>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t.artist} · {formatTime(t.durationSec)}
                </span>
              </span>
              <span className="text-xs font-medium text-ember">Use</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Side sheet review (the approved /dizajn candidate): one song at a
 *  time, source on top, candidates below with number keys, Skip. A bottom
 *  sheet below md. Keys 1 to 3 pick, S skips; typing in the search box is
 *  left alone. */
export function ReviewSheet({
  open,
  onClose,
  mode,
  playlistName,
  source,
  queue,
  index,
  busy = false,
  previewId,
  previewPlaying,
  onPreview,
  onPick,
  onSkip,
  onRemove,
  searchResults,
  searching,
  onSearch,
}: ReviewSheetProps) {
  const item = queue[index];
  const [showAll, setShowAll] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // A new song starts collapsed. Adjusted during render, not in an effect,
  // so the previous song's state never paints.
  const [shownFor, setShownFor] = useState(item?.id);
  if (shownFor !== item?.id) {
    setShownFor(item?.id);
    setShowAll(false);
    setSearchOpen(false);
  }

  const candidates = useMemo(() => item?.candidates ?? [], [item]);
  const shown = showAll ? candidates : candidates.slice(0, SHEET_KEYS);
  const hidden = candidates.length - shown.length;
  const missing = item?.status === 'missing';

  useEffect(() => {
    if (!open || !item) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= SHEET_KEYS && candidates[n - 1]) {
        e.preventDefault();
        onPick(item, candidates[n - 1].track);
      } else if ((e.key === 's' || e.key === 'S') && mode === 'review') {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, item, candidates, busy, mode, onPick, onSkip]);

  const title = mode === 'rematch' ? 'Re-match' : 'Review matches';
  const reviewCount = queue.filter((i) => i.status === 'review' || i.status === 'missing').length;

  return (
    <SheetPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <SheetPrimitive.Popup
          data-testid="review-sheet"
          aria-label={title}
          className={cn(
            'fixed z-50 flex flex-col bg-popover text-sm text-popover-foreground shadow-soft ring-1 ring-foreground/10 outline-none transition duration-200 ease-out',
            'data-ending-style:opacity-0 data-starting-style:opacity-0',
            'max-md:inset-x-0 max-md:bottom-0 max-md:pb-(--safe-bottom) max-md:max-h-[88dvh] max-md:rounded-t-2xl max-md:data-starting-style:translate-y-8 max-md:data-ending-style:translate-y-8',
            'md:inset-y-0 md:right-0 md:w-[26rem] md:data-starting-style:translate-x-8 md:data-ending-style:translate-x-8',
          )}
        >
          <div className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-muted md:hidden" />
          <div className="flex items-center gap-row border-b border-border px-block py-row">
            <div className="min-w-0 flex-1">
              <SheetPrimitive.Title className="text-sm font-semibold">{title}</SheetPrimitive.Title>
              <div data-testid="review-position" className="truncate text-xs text-muted-foreground">
                {item ? (mode === 'rematch' ? playlistName : `${index + 1} of ${queue.length} · ${playlistName}`) : `All done · ${playlistName}`}
              </div>
            </div>
            {mode === 'review' && queue.length > 1 && (
              <div className="flex shrink-0 gap-inset" aria-hidden>
                {queue.length <= MAX_PIPS ? (
                  queue.map((r, i) => (
                    <span
                      key={r.id}
                      className={cn('h-1.5 w-5 rounded-full', i < index ? 'bg-ember' : i === index ? 'bg-foreground/70' : 'bg-muted')}
                    />
                  ))
                ) : (
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full bg-ember" style={{ width: `${(Math.min(index, queue.length) / queue.length) * 100}%` }} />
                  </span>
                )}
              </div>
            )}
            <SheetPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <CloseIcon />
            </SheetPrimitive.Close>
          </div>

          {item ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto p-block">
                <SourceCard item={item} source={source} />
                <div>
                  <div className="mb-cluster text-eyebrow">
                    {mode === 'rematch' ? 'Pick the right one' : missing ? 'Closest on YouTube' : 'Pick the right one'}
                  </div>
                  {candidates.length === 0 && (
                    <div className="text-sm text-muted-foreground">Nothing came back for this song. Try a search.</div>
                  )}
                  <div className="-mx-cluster flex flex-col gap-inset">
                    {shown.map((c, i) => (
                      <CandidateRow
                        key={c.track.id}
                        candidate={c}
                        best={i === 0 && !missing}
                        current={mode === 'rematch' && c.track.sourceId === item.videoId}
                        keyHint={i < SHEET_KEYS ? String(i + 1) : undefined}
                        previewing={previewId === c.track.id}
                        playing={previewPlaying}
                        disabled={busy}
                        onPick={() => onPick(item, c.track)}
                        onPreview={() => onPreview(c.track)}
                      />
                    ))}
                  </div>
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="mt-cluster text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Show {hidden} more
                    </button>
                  )}
                </div>
                {searchOpen ? (
                  <SearchPanel
                    initial={`${item.source.title} ${item.source.artist}`.trim()}
                    results={searchResults}
                    searching={searching}
                    busy={busy}
                    onSearch={onSearch}
                    onUse={(t) => onPick(item, t)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-cluster">
                    <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                      <SearchIcon className="h-3.5 w-3.5" />
                      Search YouTube
                    </Button>
                    {mode === 'review' && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={() => onRemove(item)}>
                        <TrashIcon className="h-3.5 w-3.5" />
                        Remove song
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-cluster border-t border-border bg-muted/40 px-block py-row">
                <div className="flex min-w-0 flex-1 items-center gap-inset text-xs text-muted-foreground max-md:hidden">
                  <Kbd>1</Kbd>
                  <Kbd>2</Kbd>
                  <Kbd>3</Kbd>
                  <span className="ml-inset">to pick</span>
                </div>
                {mode === 'review' ? (
                  <>
                    <Button variant="ghost" onClick={onSkip} className="max-md:flex-1">
                      Skip
                      <span className="max-md:hidden">
                        <Kbd>S</Kbd>
                      </span>
                    </Button>
                    <Button
                      onClick={() => candidates[0] && onPick(item, candidates[0].track)}
                      disabled={busy || !candidates[0] || missing}
                      variant="ember"
                      className="max-md:flex-1"
                    >
                      Use best match
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={onClose} className="max-md:flex-1">
                    Keep it
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div data-testid="review-done" className="flex flex-1 flex-col items-center justify-center gap-cluster p-stack text-center">
              <span className="grid size-11 place-items-center rounded-full bg-ember/15 text-ember">
                <CheckIcon className="h-5 w-5" />
              </span>
              <div className="text-base font-semibold">All reviewed</div>
              <div className="text-meta">
                {reviewCount
                  ? 'Skipped songs stay marked in the playlist so you can come back to them.'
                  : 'Every song from the import is settled.'}
              </div>
              <Button variant="outline" size="sm" className="mt-cluster" onClick={onClose}>
                Back to the playlist
              </Button>
            </div>
          )}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
