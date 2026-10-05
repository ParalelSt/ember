'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { formatTime } from '@/lib/format';

/** Add a song from your own files. It lands on the server and becomes
 *  searchable for everyone — that's the point: the library grows with the
 *  things YouTube doesn't have. */
export function UploadTrackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  /** What the last picked file's name filled in: a field still holding it
   *  is the app's guess, not the member's, and the next file replaces it. */
  const prefilled = useRef({ title: '', artist: '' });
  /** The newest pick: a slower length read of an earlier file is dropped. */
  const pickSeq = useRef(0);

  const reset = () => {
    pickSeq.current++;
    prefilled.current = { title: '', artist: '' };
    setFile(null);
    setTitle('');
    setArtist('');
    setAlbum('');
    setDurationSec(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  /** Every way out of the dialog forgets the picked file: Cancel too, or
   *  reopening would show an empty picker with the old file still set to
   *  upload. */
  const close = () => {
    reset();
    onOpenChange(false);
  };

  /** Read the duration in the browser — the server can't count on ffprobe
   *  being installed, and a wrong duration makes the progress bar lie. */
  const readDuration = (f: File) =>
    new Promise<number>((resolve) => {
      const url = URL.createObjectURL(f);
      const audio = new Audio();
      const done = (v: number) => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(v) && v > 0 ? v : 0);
      };
      audio.addEventListener('loadedmetadata', () => done(audio.duration), { once: true });
      audio.addEventListener('error', () => done(0), { once: true });
      audio.src = url;
    });

  const pick = async (f: File | null) => {
    const seq = ++pickSeq.current;
    setFile(f);
    setDurationSec(0);
    if (!f) return;
    // Pre-fill from the filename so the common case is one click. A field
    // the member typed in is theirs; one still holding the previous file's
    // guess takes this file's.
    const base = f.name.replace(/\.[^.]+$/, '');
    const dash = base.split(/\s+-\s+/);
    const guess = dash.length >= 2
      ? { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() }
      : { artist: '', title: base };
    const last = prefilled.current;
    const next = { title: last.title, artist: last.artist };
    if (!title || title === last.title) {
      setTitle(guess.title);
      next.title = guess.title;
    }
    if (!artist || artist === last.artist) {
      setArtist(guess.artist);
      next.artist = guess.artist;
    }
    prefilled.current = next;
    const length = await readDuration(f);
    if (seq === pickSeq.current) setDurationSec(length);
  };

  const upload = useMutation({
    mutationFn: () => api.uploadTrack(file!, { title: title.trim(), artist: artist.trim(), album: album.trim(), durationSec }),
    onSuccess: ({ track }) => {
      toast.success(`Uploaded “${track.title}”`, { description: 'Everyone on the server can find it now.' });
      void qc.invalidateQueries({ queryKey: QK.uploads });
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim() || upload.isPending) return;
    upload.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a song</DialogTitle>
          <DialogDescription>
            Adds a file from your device to this server. Everyone signed in can search and play it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-card/80"
          />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={200} />
          <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" maxLength={200} />
          <Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album (optional)" maxLength={200} />
          {file && (
            <div className="text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)}MB
              {durationSec > 0 && ` · ${formatTime(durationSec)}`}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!file || !title.trim() || upload.isPending}
              variant="ember"
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
