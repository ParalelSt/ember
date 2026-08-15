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

  const reset = () => {
    setFile(null);
    setTitle('');
    setArtist('');
    setAlbum('');
    setDurationSec(0);
    if (inputRef.current) inputRef.current.value = '';
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
    setFile(f);
    if (!f) return;
    // Pre-fill from the filename so the common case is one click.
    const base = f.name.replace(/\.[^.]+$/, '');
    const dash = base.split(/\s+-\s+/);
    if (dash.length >= 2) {
      if (!artist) setArtist(dash[0].trim());
      if (!title) setTitle(dash.slice(1).join(' - ').trim());
    } else if (!title) {
      setTitle(base);
    }
    setDurationSec(await readDuration(f));
  };

  const upload = useMutation({
    mutationFn: () => api.uploadTrack(file!, { title: title.trim(), artist: artist.trim(), album: album.trim(), durationSec }),
    onSuccess: ({ track }) => {
      toast.success(`Uploaded “${track.title}”`, { description: 'Everyone on the server can find it now.' });
      void qc.invalidateQueries({ queryKey: QK.uploads });
      reset();
      onOpenChange(false);
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
              {durationSec > 0 && ` · ${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!file || !title.trim() || upload.isPending}
              className="bg-ember hover:bg-ember-soft text-white"
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
