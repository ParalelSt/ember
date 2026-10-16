'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrashIcon } from '@/components/icons';
import type { AdminTrack } from '@/lib/api';
import { AdminSheet } from './AdminSheet';
import { useTrackEdit } from './useTrackEdit';

interface Props {
  tracks: AdminTrack[];
  /** Delete was picked in the edit sheet: the page asks to confirm. */
  onDelete: (track: AdminTrack) => void;
}

/** Admin > Tracks on a phone: covers three across, title and artist under
 *  each. Tapping one opens Edit track (title, artist, album, Save, Delete)
 *  as a bottom sheet. */
export function TrackGrid({ tracks, onDelete }: Props) {
  const [editing, setEditing] = useState<AdminTrack | null>(null);

  return (
    <>
      <ul aria-label="Tracks" className="grid grid-cols-3 gap-row">
        {tracks.map((t) => (
          <li key={t.recordId} className="min-w-0">
            <button
              type="button"
              data-testid="track-tile"
              aria-label={`Edit ${t.title} by ${t.artist}`}
              onClick={() => setEditing(t)}
              className="flex w-full min-w-0 flex-col gap-inset text-left"
            >
              <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-art">
                {t.artworkUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.artworkUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </span>
              <span className="truncate text-xs font-semibold">{t.title}</span>
              <span className="truncate text-xs text-muted-foreground">{t.artist}</span>
              {t.missing && (
                <span className="text-[10px] font-semibold uppercase text-destructive">Missing</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <AdminSheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit track"
        data-testid="track-edit-sheet"
      >
        {editing && (
          <TrackEditForm
            key={editing.recordId}
            track={editing}
            onDone={() => setEditing(null)}
            onDelete={() => {
              const t = editing;
              setEditing(null);
              onDelete(t);
            }}
          />
        )}
      </AdminSheet>
    </>
  );
}

function TrackEditForm({ track, onDone, onDelete }: { track: AdminTrack; onDone: () => void; onDelete: () => void }) {
  const { title, setTitle, artist, setArtist, album, setAlbum, busy, save } = useTrackEdit(track, onDone);
  const id = (f: string) => `phone-t-${f}-${track.recordId}`;
  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('title')}>Title</Label>
        <Input id={id('title')} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('artist')}>Artist</Label>
        <Input id={id('artist')} value={artist} onChange={(e) => setArtist(e.target.value)} />
      </div>
      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('album')}>Album</Label>
        <Input id={id('album')} value={album} onChange={(e) => setAlbum(e.target.value)} />
      </div>
      <div className="flex items-center gap-cluster">
        <Button
          type="button"
          variant="outline"
          className="h-11 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <TrashIcon className="size-4" />
          Delete
        </Button>
        <Button type="button" variant="ember" className="h-11 flex-1" onClick={save} disabled={busy}>
          {busy ? '…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
