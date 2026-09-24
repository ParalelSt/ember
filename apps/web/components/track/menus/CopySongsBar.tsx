'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Popover } from '@base-ui/react/popover';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CheckIcon, ChevronDownIcon, CopyToIcon, HeartIcon, PlusIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  useExecuteBulkAddToPlaylist,
  useExecuteBulkLike,
  useExecuteCreatePlaylist,
  useExecuteDeletePlaylist,
  useQueryLikes,
  useQueryPlaylistTracks,
  useQueryPlaylists,
} from '@/hooks/useLibrary';
import { formatCount } from '@/lib/format';
import { alreadyCount, planCopy, resultLine, skipLine, type CopyOutcome } from '@/lib/playlistCopy';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

/** Where the picked songs come from: never offered as a destination. */
export type CopySource = { kind: 'playlist'; id: string } | { kind: 'liked' };

interface Landed {
  kind: 'liked' | 'playlist';
  name: string;
  href: string;
}

interface Result {
  destination: Landed;
  outcome: CopyOutcome;
}

export interface CopySongsBarProps {
  source: CopySource;
  selecting: boolean;
  /** The picked songs, in the list's order. */
  picked: Track[];
  onClear: () => void;
  /** Leave select mode (after a copy). */
  onDone: () => void;
}

/** The bar that sticks to the bottom of a collection page while selecting:
 *  "N selected", Clear and Copy to…, then the result of the copy in the
 *  same place ("Added 12, skipped 3 already there", with Which?). Copy
 *  to… lists New playlist, Liked songs and the member's playlists, each
 *  with how many of the picked songs it already has; Liked songs asks
 *  first, because copying there likes every one of them. The routes
 *  re-check duplicates, so the counts here are a preview and the result is
 *  what the server did. It sits inside the page's scroller, so it never
 *  covers the player bar or the phone nav. */
export function CopySongsBar({ source, selecting, picked, onClear, onDone }: CopySongsBarProps) {
  const isDesktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmLiked, setConfirmLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // A new selection replaces the last result (adjusting state during
  // render, not in an effect: https://react.dev/learn/you-might-not-need-an-effect).
  const [wasSelecting, setWasSelecting] = useState(selecting);
  if (selecting !== wasSelecting) {
    setWasSelecting(selecting);
    if (selecting) setResult(null);
  }

  const bulkAdd = useExecuteBulkAddToPlaylist();
  const bulkLike = useExecuteBulkLike();
  const createPlaylist = useExecuteCreatePlaylist();
  const deletePlaylist = useExecuteDeletePlaylist();
  const { data: liked = [] } = useQueryLikes();
  const { data: allPlaylists = [] } = useQueryPlaylists();
  const playlists = allPlaylists.filter((p) => !(source.kind === 'playlist' && p.id === source.id));
  const lists = useQueryPlaylistTracks(
    playlists.map((p) => p.id),
    pickerOpen,
  );
  const likedPlan = planCopy(picked, liked);
  const count = picked.length;

  if (!selecting && !result) return null;

  const run = async (work: () => Promise<Result>) => {
    if (busy) return;
    setBusy(true);
    try {
      const { destination, outcome } = await work();
      setPickerOpen(false);
      setConfirmLiked(false);
      setResult({ destination, outcome });
      onDone();
    } catch (e) {
      toast.error((e as Error).message || 'Couldn’t copy those songs, please try again.');
    } finally {
      setBusy(false);
    }
  };

  const toPlaylist = (id: string, name: string) =>
    run(async () => ({
      destination: { kind: 'playlist', name, href: `/playlist/${id}` },
      outcome: await bulkAdd.mutateAsync({ id, tracks: picked }),
    }));

  const toNewPlaylist = (name: string) =>
    run(async () => {
      const made = await createPlaylist.mutateAsync(name);
      try {
        const outcome = await bulkAdd.mutateAsync({ id: made.id, tracks: picked });
        return { destination: { kind: 'playlist', name: made.name, href: `/playlist/${made.id}` }, outcome };
      } catch {
        // An empty playlist nobody asked for would be left behind.
        await deletePlaylist.mutateAsync(made.id).catch(() => {});
        throw new Error('Couldn’t copy the songs, so the new playlist was removed. Please try again.');
      }
    });

  const toLiked = () =>
    run(async () => ({
      destination: { kind: 'liked', name: 'Liked songs', href: '/library/liked' },
      outcome: await bulkLike.mutateAsync(picked),
    }));

  const destinations = (
    <DestinationList
      picked={picked}
      liked={source.kind === 'liked' ? null : liked}
      playlists={playlists.map((p) => ({ id: p.id, name: p.name, cover: p.artwork_url, tracks: lists.get(p.id) ?? null }))}
      busy={busy}
      onPlaylist={toPlaylist}
      onNew={toNewPlaylist}
      onLiked={() => {
        setPickerOpen(false);
        setConfirmLiked(true);
      }}
    />
  );
  const pickerTitle = `Copy ${formatCount(count, 'song')} to`;

  const copyButtonClass = 'h-10 rounded-full px-block';
  const copyButtonBody = (
    <>
      <CopyToIcon className="size-4" />
      Copy to…
    </>
  );

  return (
    <>
      {/* data-copy-bar: globals.css lifts Back to top over it. */}
      <div data-copy-bar className="sticky bottom-block z-20 mt-stack flex justify-center">
        <div
          data-testid="copy-bar"
          className="w-full max-w-2xl rounded-xl border border-border bg-popover px-block py-row text-popover-foreground shadow-soft"
        >
          {selecting ? (
            <div className="flex items-center gap-row">
              <span data-testid="copy-count" className="min-w-0 flex-1 truncate text-sm font-semibold">
                {count === 0 ? 'Pick songs to copy' : `${count} selected`}
              </span>
              {count > 0 && (
                <Button variant="ghost" onClick={onClear} className="h-10 rounded-full px-row">
                  Clear
                </Button>
              )}
              {isDesktop ? (
                <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
                  <Popover.Trigger
                    disabled={count === 0}
                    data-testid="copy-to"
                    render={<Button variant="ember" className={copyButtonClass} />}
                  >
                    {copyButtonBody}
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner side="top" align="end" sideOffset={8} collisionPadding={16} className="isolate z-50">
                      <Popover.Popup
                        data-testid="copy-picker"
                        className="flex max-h-(--available-height) w-80 flex-col rounded-xl border border-border bg-popover p-cluster text-popover-foreground shadow-soft outline-none"
                      >
                        <Popover.Title className="px-cluster pb-cluster pt-inset text-sm font-semibold">{pickerTitle}</Popover.Title>
                        <div className="min-h-0 overflow-y-auto">{destinations}</div>
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              ) : (
                <Button
                  variant="ember"
                  disabled={count === 0}
                  data-testid="copy-to"
                  onClick={() => setPickerOpen(true)}
                  className={copyButtonClass}
                >
                  {copyButtonBody}
                </Button>
              )}
            </div>
          ) : (
            result && <ResultPanel result={result} onDone={() => setResult(null)} />
          )}
        </div>
      </div>

      {!isDesktop && (
        <BottomSheet open={pickerOpen} onOpenChange={setPickerOpen} title={pickerTitle} testId="copy-picker">
          {destinations}
        </BottomSheet>
      )}

      {isDesktop ? (
        <Dialog open={confirmLiked} onOpenChange={(o) => !busy && setConfirmLiked(o)}>
          <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <LikedWarning count={count} already={likedPlan.skipped.length} toLike={likedPlan.add.length} busy={busy} onConfirm={toLiked} onCancel={() => setConfirmLiked(false)} />
          </DialogContent>
        </Dialog>
      ) : (
        <BottomSheet open={confirmLiked} onOpenChange={(o) => !busy && setConfirmLiked(o)}>
          <LikedWarning count={count} already={likedPlan.skipped.length} toLike={likedPlan.add.length} busy={busy} onConfirm={toLiked} onCancel={() => setConfirmLiked(false)} stacked />
        </BottomSheet>
      )}
    </>
  );
}

/** A sheet up from the bottom of a phone, clear of Android's buttons. */
function BottomSheet({
  open,
  onOpenChange,
  title,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={!!title} data-testid={testId} className="max-h-[85svh] gap-block rounded-t-2xl safe-area-bottom">
        <div className="flex min-h-0 flex-col gap-block px-block pt-block pb-stack">
          {title ? (
            <SheetTitle className="pr-section text-base font-semibold">{title}</SheetTitle>
          ) : null}
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface PlaylistChoice {
  id: string;
  name: string;
  cover: string | null;
  /** Null while its songs are loading. */
  tracks: Track[] | null;
}

/** Where to: New playlist (named inline), Liked songs (unless that is the
 *  source), then the member's playlists, each saying how many of the
 *  picked songs it already has. A destination that already has all of
 *  them is shown but can't be picked. */
function DestinationList({
  picked,
  liked,
  playlists,
  busy,
  onPlaylist,
  onNew,
  onLiked,
}: {
  picked: Track[];
  liked: Track[] | null;
  playlists: PlaylistChoice[];
  busy: boolean;
  onPlaylist: (id: string, name: string) => void;
  onNew: (name: string) => void;
  onLiked: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('New playlist');
  return (
    <div data-testid="copy-destinations" className="flex flex-col gap-inset">
      {naming ? (
        <form
          className="flex items-center gap-cluster px-cluster py-cluster"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onNew(name.trim());
          }}
        >
          <input
            aria-label="New playlist name"
            autoFocus
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-row text-sm"
          />
          <Button type="submit" variant="ember" disabled={busy || !name.trim()} className="h-10 rounded-full px-block">
            Create
          </Button>
        </form>
      ) : (
        <DestinationRow
          id="new"
          cover={
            <div className="grid size-art-xs shrink-0 place-items-center rounded bg-card text-ember">
              <PlusIcon className="size-5" />
            </div>
          }
          name="New playlist"
          nameClass="text-ember"
          note={`With these ${formatCount(picked.length, 'song')}`}
          onChoose={() => setNaming(true)}
          disabled={busy}
        />
      )}
      {liked && (
        <DestinationRow
          id="liked"
          cover={
            <div className="cover-placeholder grid size-art-xs shrink-0 place-items-center rounded">
              <HeartIcon className="size-4 fill-current text-ember-foreground" />
            </div>
          }
          name="Liked songs"
          {...counts(picked, liked, 'liked')}
          onChoose={onLiked}
          disabled={busy}
        />
      )}
      {playlists.length > 0 && <div className="text-eyebrow px-cluster pt-cluster">Playlists</div>}
      {playlists.map((p) => (
        <DestinationRow
          key={p.id}
          id={p.id}
          cover={
            <Artwork src={p.cover} size="xs" fallback="gradient" className="shrink-0 rounded">
              {null}
            </Artwork>
          }
          name={p.name}
          {...(p.tracks ? counts(picked, p.tracks, 'there') : { note: 'Checking…', all: false })}
          onChoose={() => onPlaylist(p.id, p.name)}
          disabled={busy}
        />
      ))}
    </div>
  );
}

/** "2 already there, 3 to add", or "All 5 already there". */
function counts(picked: Track[], destination: Track[], word: 'there' | 'liked'): { note: string; all: boolean } {
  const already = alreadyCount(picked, destination);
  const toAdd = planCopy(picked, destination).add.length;
  if (picked.length > 0 && toAdd === 0) {
    return { note: already === 1 ? `Already ${word}` : `All ${already} already ${word}`, all: true };
  }
  return { note: `${already} already ${word}, ${toAdd} to add`, all: false };
}

function DestinationRow({
  id,
  cover,
  name,
  nameClass,
  note,
  all = false,
  disabled,
  onChoose,
}: {
  id: string;
  cover: ReactNode;
  name: string;
  nameClass?: string;
  note: string;
  all?: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="copy-destination"
      data-destination={id}
      onClick={onChoose}
      disabled={disabled || all}
      className="flex w-full min-w-0 items-center gap-row rounded-md px-cluster py-cluster text-left transition-colors hover:bg-card disabled:opacity-50"
    >
      {cover}
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-semibold', nameClass)}>{name}</div>
        <div data-testid="copy-destination-note" className="truncate text-xs text-muted-foreground">
          {note}
        </div>
      </div>
    </button>
  );
}

/** Copying into Liked songs likes every one of the songs: said before it
 *  happens, with the counts. Nothing is liked until "Like N songs". */
function LikedWarning({
  count,
  already,
  toLike,
  busy,
  onConfirm,
  onCancel,
  stacked = false,
}: {
  count: number;
  already: number;
  toLike: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Buttons full width, one per line (a phone sheet). */
  stacked?: boolean;
}) {
  return (
    <div data-testid="copy-liked-confirm" className="flex flex-col gap-block">
      <div className="flex items-start gap-row">
        <div className="cover-placeholder grid size-art-xs shrink-0 place-items-center rounded-full">
          <HeartIcon className="size-5 fill-current text-ember-foreground" />
        </div>
        <div className="min-w-0">
          <DialogTitle className="text-section-title">
            Like {formatCount(count, 'song')}?
          </DialogTitle>
          <DialogDescription className="text-meta mt-cluster">
            Adding songs to Liked songs <span className="font-semibold text-foreground">likes every one of them</span>: each
            one gets its heart, everywhere in Ember, the same as tapping it yourself.
          </DialogDescription>
          {already > 0 && (
            <p data-testid="copy-liked-already" className="text-meta mt-cluster">
              {already} {already === 1 ? 'is' : 'are'} already liked, so {formatCount(toLike, 'song')}{' '}
              {toLike === 1 ? 'gets' : 'get'} a new like.
            </p>
          )}
        </div>
      </div>
      <div className={cn('flex gap-cluster', stacked ? 'flex-col-reverse' : 'justify-end')}>
        <Button variant="ghost" onClick={onCancel} disabled={busy} className={cn('h-10 rounded-full px-block', stacked && 'w-full')}>
          Cancel
        </Button>
        <Button
          variant="ember"
          onClick={onConfirm}
          disabled={busy || toLike === 0}
          data-testid="copy-liked-yes"
          className={cn('h-10 rounded-full px-block', stacked && 'w-full')}
        >
          <HeartIcon className="size-4 fill-current" />
          Like {formatCount(toLike, 'song')}
        </Button>
      </div>
    </div>
  );
}

/** What happened: "Added 12, skipped 3 already there", where, and which
 *  were skipped and why (behind Which?). */
function ResultPanel({ result, onDone }: { result: Result; onDone: () => void }) {
  const { outcome, destination } = result;
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="copy-result" className="flex min-w-0 flex-col gap-cluster">
      <div className="flex min-w-0 items-start gap-row">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-ember text-ember-foreground">
          <CheckIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div data-testid="copy-result-line" className="text-sm font-semibold">
            {resultLine(outcome)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {destination.kind === 'liked' ? 'Liked songs: every added song now has its heart' : `In ${destination.name}`}
          </div>
        </div>
        {outcome.skipped.length > 0 && (
          <button
            type="button"
            data-testid="copy-which"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-inset text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? 'Hide' : 'Which?'}
            <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && outcome.skipped.length > 0 && (
        <ul data-testid="copy-skipped" className="flex max-h-48 flex-col gap-inset overflow-y-auto rounded-md bg-card px-row py-cluster">
          {outcome.skipped.map((s, i) => (
            <li key={`${s.id}:${i}`} className="min-w-0 break-words text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{s.title}</span>
              {s.artist ? ` · ${s.artist}` : ''}: {skipLine(s)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-cluster">
        <Button variant="ghost" onClick={onDone} data-testid="copy-done" className="h-9 rounded-full px-block">
          Done
        </Button>
        <Link
          href={destination.href}
          data-testid="copy-open"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-9 max-w-full rounded-full px-block')}
        >
          <span className="truncate">Open {destination.name}</span>
        </Link>
      </div>
    </div>
  );
}
