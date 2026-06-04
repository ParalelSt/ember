'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TrackSearchPicker } from '@/components/track/TrackSearchPicker';
import { TrashIcon } from '@/components/icons';
import type { Track } from '@/types/track';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed name + selected tracks on submit. The dialog
   *  awaits the promise then closes; clearing happens automatically. */
  onCreate: (name: string, tracks: Track[]) => Promise<unknown> | unknown;
  /** Optional pre-selected tracks (e.g. the currently-playing track when this
   *  dialog is opened from the AddToPlaylistMenu). */
  initialTracks?: Track[];
}

/** In-app "New playlist" dialog with name field + track picker. Replaces the
 *  native browser prompt; lets users seed the playlist with songs at creation
 *  time and surfaces recommendations based on what they've added. */
export function CreatePlaylistDialog({ open, onOpenChange, onCreate, initialTracks }: Props) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset the field on every fresh open; seed selected from initialTracks.
  useEffect(() => {
    if (open) {
      setName('');
      setSelected(initialTracks ?? []);
    }
  }, [open, initialTracks]);

  const addTrack = (t: Track) =>
    setSelected((s) => (s.some((x) => x.id === t.id) ? s : [...s, t]));
  const removeTrack = (t: Track) =>
    setSelected((s) => s.filter((x) => x.id !== t.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed, selected);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4 min-h-0">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name (e.g. Metal)"
            maxLength={120}
            required
          />

          {selected.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {selected.length} {selected.length === 1 ? 'track' : 'tracks'} to add
              </div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto -mx-1 px-1">
                {selected.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/60">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">{t.title}</span>
                      <span className="text-muted-foreground"> — {t.artist}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeTrack(t)}
                      aria-label="Remove"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <TrackSearchPicker added={selected} seeds={selected} onAdd={addTrack} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !name.trim()}
              className="bg-ember hover:bg-ember-soft text-white"
            >
              {busy
                ? 'Creating…'
                : selected.length
                  ? `Create + add ${selected.length}`
                  : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
