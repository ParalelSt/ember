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
import { LinkIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

type Mode = 'empty' | 'import';

const TABS: { id: Mode; label: string }[] = [
  { id: 'empty', label: 'Start empty' },
  { id: 'import', label: 'Import from a link' },
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

/** In-app "New playlist" dialog. Two tabs (the approved /dizajn "Tabs"
 *  choice): "Start empty" is the name field and track picker, seeded with
 *  songs at creation time; "Import from a link" brings over a Spotify or
 *  YouTube Music playlist, which then fills in on the server. */
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col" data-testid="create-playlist-dialog">
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
        </DialogHeader>
        <div role="tablist" aria-label="New playlist" className="flex gap-stack border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                '-mb-px flex items-center gap-cluster border-b-2 pb-cluster text-sm font-medium transition-colors',
                mode === t.id ? 'border-ember text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.id === 'import' ? <LinkIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
              {t.label}
            </button>
          ))}
        </div>

        {mode === 'import' ? (
          <ImportLinkForm onCancel={() => onOpenChange(false)} onCreated={imported} />
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-col gap-block">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name (e.g. Metal)"
              maxLength={120}
              required
            />

            {selected.length > 0 && (
              <div className="flex flex-col gap-cluster">
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {formatCount(selected.length, 'track')} to add
                </div>
                <div className="-mx-inset flex max-h-32 flex-col gap-inset overflow-y-auto px-inset">
                  {selected.map((t) => (
                    <div key={t.id} className="flex items-center gap-cluster rounded-md px-cluster py-inset hover:bg-accent/60">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium">{t.title}</span>
                        <span className="text-muted-foreground">, {t.artist}</span>
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
                variant="ember"
              >
                {busy
                  ? 'Creating…'
                  : selected.length
                    ? `Create + add ${selected.length}`
                    : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
