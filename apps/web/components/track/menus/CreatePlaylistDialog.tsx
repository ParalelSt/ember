'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TrackSearchPicker } from '@/components/track/menus/TrackSearchPicker';
import { ImportLinkForm } from '@/components/track/menus/ImportLinkForm';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

type Mode = 'empty' | 'import';

const TABS: { id: Mode; label: string }[] = [
  { id: 'empty', label: 'Start new' },
  { id: 'import', label: 'Import a link' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed name + selected tracks on submit. The dialog
   *  awaits the promise then closes; clearing happens automatically. */
  onCreate: (name: string, tracks: Track[]) => Promise<unknown> | unknown;
  /** Optional pre-selected tracks (e.g. the currently-playing track when this
   *  dialog is opened from the AddToPlaylistMenu). */
  initialTracks?: Track[];
  /** After an import was started (the dialog has closed and the app is on
   *  its way to the new playlist): the mobile drawer closes itself here. */
  onImported?: (playlistId: string) => void;
}

/** In-app "New playlist" dialog, all on one page (the owner's newplaylist1
 *  pick): a Start new / Import a link switch; Start new is a live cover that
 *  fills in with the songs added (one cover, then a 2x2 mosaic from four),
 *  the name beside it, then search and suggestions, and Create says how many
 *  songs come along. Import a link brings over a Spotify or YouTube Music
 *  playlist, which then fills in on the server. */
export function CreatePlaylistDialog({ open, onOpenChange, onCreate, initialTracks, onImported }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('empty');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Track[]>(initialTracks ?? []);
  const [busy, setBusy] = useState(false);

  // Reset on every fresh open; seed selected from initialTracks. Adjusted
  // during render rather than in an effect, so the last session's name or
  // tab never paints.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode('empty');
      setName('');
      setSelected(initialTracks ?? []);
    }
  }

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

  const imported = (playlistId: string) => {
    onOpenChange(false);
    onImported?.(playlistId);
    router.push(`/playlist/${playlistId}`);
  };

  const covers = selected.map((t) => t.artworkUrl).filter((u): u is string => !!u);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col gap-block" data-testid="create-playlist-dialog">
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
        </DialogHeader>
        <div role="tablist" aria-label="New playlist" className="grid grid-cols-2 rounded-full bg-background p-inset">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                'h-9 rounded-full text-sm font-semibold transition-colors',
                mode === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === 'import' ? (
          <ImportLinkForm onCancel={() => onOpenChange(false)} onCreated={imported} />
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-col gap-block">
            <div className="flex items-center gap-block">
              <CollectionCover
                src={covers[0] ?? null}
                mosaic={covers}
                icon={null}
                className="size-22 shrink-0 rounded-xl shadow-lg"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-cluster">
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name your playlist"
                  aria-label="Playlist name"
                  maxLength={120}
                  required
                  className="h-11 rounded-xl text-base"
                />
                <span data-testid="added-count" className="text-xs text-muted-foreground">
                  {selected.length ? `${formatCount(selected.length, 'song')} added` : 'Songs you add show in the cover'}
                </span>
              </div>
            </div>

            <TrackSearchPicker added={selected} seeds={selected} onAdd={addTrack} onRemove={removeTrack} />

            <DialogFooter className="border-t border-border pt-row">
              <Button type="button" variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()} variant="ember" className="rounded-full px-stack">
                {busy
                  ? 'Creating…'
                  : selected.length
                    ? `Create with ${formatCount(selected.length, 'song')}`
                    : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
