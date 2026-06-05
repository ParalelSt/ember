'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoreIcon, TrashIcon } from '@/components/icons';
import {
  useExecuteDeleteAdminTrack,
  useExecuteUpdateAdminTrack,
  useQueryAdminTracks,
} from '@/hooks/useAdmin';
import type { AdminTrack } from '@/lib/api';

export default function AdminTracksPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const { data, isLoading, isFetching } = useQueryAdminTracks(page, committedSearch);
  const deleteTrack = useExecuteDeleteAdminTrack();

  const [pendingDelete, setPendingDelete] = useState<AdminTrack | null>(null);

  const submitSearch = () => {
    setPage(1);
    setCommittedSearch(searchInput.trim());
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-bold tracking-tight">
          Tracks{data ? ` · ${data.totalItems}` : ''}
        </h2>
        <form
          onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
          className="flex gap-2"
        >
          <Input
            placeholder="Search title or artist…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" size="sm">Search</Button>
        </form>
      </div>

      {isLoading && <div className="text-muted-foreground py-12 text-center">Loading…</div>}
      {!isLoading && data && data.tracks.length === 0 && (
        <div className="text-muted-foreground py-12 text-center">No tracks match.</div>
      )}

      {data && data.tracks.length > 0 && (
        <>
          <div className="flex flex-col gap-1">
            {data.tracks.map((t) => (
              <TrackRow key={t.recordId} track={t} onDelete={() => setPendingDelete(t)} />
            ))}
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            busy={isFetching}
            onChange={setPage}
          />
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={pendingDelete ? `Delete "${pendingDelete.title}"?` : ''}
        description="This also removes the track from any playlist that contains it and clears its like / play history."
        confirmLabel="Delete track"
        variant="destructive"
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteTrack.mutateAsync(pendingDelete.recordId);
            toast.success(`Deleted "${pendingDelete.title}"`);
            setPendingDelete(null);
          } catch (e) {
            toast.error(`Couldn't delete: ${(e as Error).message}`);
            throw e;
          }
        }}
      />
    </section>
  );
}

function TrackRow({ track, onDelete }: { track: AdminTrack; onDelete: () => void }) {
  const updateTrack = useExecuteUpdateAdminTrack();
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateTrack.mutateAsync({
        recordId: track.recordId,
        patch: {
          title: title !== track.title ? title : undefined,
          artist: artist !== track.artist ? artist : undefined,
          album: album !== (track.album ?? '') ? album : undefined,
        },
      });
      toast.success('Track updated');
      setEditOpen(false);
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1.2fr)_60px_auto] gap-3 items-center px-3 py-2 rounded-md hover:bg-card transition-colors">
      <div className="relative h-10 w-10 rounded bg-black overflow-hidden shrink-0">
        {track.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artworkUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
      <div className="truncate text-sm text-muted-foreground">{track.album ?? ''}</div>
      <div className="text-xs text-muted-foreground uppercase">{track.source}</div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Edit"
        onClick={() => setEditOpen(true)}
      >
        <MoreIcon className="h-4 w-4" />
      </Button>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit track</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`t-title-${track.recordId}`}>Title</Label>
              <Input id={`t-title-${track.recordId}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`t-artist-${track.recordId}`}>Artist</Label>
              <Input id={`t-artist-${track.recordId}`} value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`t-album-${track.recordId}`}>Album</Label>
              <Input id={`t-album-${track.recordId}`} value={album} onChange={(e) => setAlbum(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="flex justify-between items-center sm:justify-between mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setEditOpen(false); onDelete(); }}
              className="text-destructive hover:text-destructive"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={busy}
              size="sm"
              className="bg-ember hover:bg-ember-soft text-white"
            >
              {busy ? '…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  busy,
  onChange,
}: {
  page: number;
  totalPages: number;
  busy: boolean;
  onChange: (n: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page === 1 || busy}
        onClick={() => onChange(page - 1)}
      >
        ‹ Prev
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page >= totalPages || busy}
        onClick={() => onChange(page + 1)}
      >
        Next ›
      </Button>
    </div>
  );
}
