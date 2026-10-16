'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CloseIcon, ImageUploadIcon } from '@/components/icons';
import { formatAddedDate } from '@/lib/format';
import { formatMb } from '@/lib/uploadQueue';
import { useMyUploadActions } from '@/hooks/useMyUploads';
import type { MyUpload } from '@/types/track';
import { UploadCover } from './UploadCover';

/** Same cap as the server (lib/uploads/cover MAX_COVER_BYTES). */
export const MAX_COVER_MB = 5;
const COVER_TYPES = ['image/jpeg', 'image/png'];

/** Why a picked image cannot be a cover, or null when it may go. */
export function coverRejectReason(file: File): string | null {
  if (!COVER_TYPES.includes(file.type.toLowerCase())) return 'A cover must be a JPEG or PNG image';
  if (file.size > MAX_COVER_MB * 1024 * 1024) return `That image is too large: the limit is ${MAX_COVER_MB} MB`;
  return null;
}

interface Props {
  upload: MyUpload | null;
  desktop: boolean;
  onClose: () => void;
}

/** Edit details: a bottom sheet on a phone, a centered window on a desktop.
 *  Cover (Upload cover, Remove cover), title, artist, album, and a line
 *  saying the file itself cannot change. Nothing is sent until Save. */
export function EditUploadSheet({ upload, desktop, onClose }: Props) {
  const open = upload !== null;
  const body = upload && <EditUploadForm key={upload.id} upload={upload} onClose={onClose} />;
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent showCloseButton={false} data-testid="edit-upload" className="gap-block sm:max-w-md">
          <DialogTitle className="sr-only">Edit song</DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="edit-upload"
        className="mx-auto max-h-[90vh] w-full max-w-lg gap-block overflow-y-auto rounded-t-2xl p-page"
      >
        <SheetTitle className="sr-only">Edit song</SheetTitle>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function EditUploadForm({ upload, onClose }: { upload: MyUpload; onClose: () => void }) {
  const { update, setCover, removeCover } = useMyUploadActions();
  const [title, setTitle] = useState(upload.title);
  const [artist, setArtist] = useState(upload.artist === 'Unknown artist' ? '' : upload.artist);
  const [album, setAlbum] = useState(upload.album ?? '');
  /** A picked cover not saved yet, or `removed` for Remove cover. */
  const [cover, setCoverDraft] = useState<File | 'removed' | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = useMemo(
    () => (cover instanceof File && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(cover) : null),
    [cover],
  );
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  const shown = cover === 'removed' ? null : cover ? preview : upload.artworkUrl;
  const id = (f: string) => `upload-${f}-${upload.sourceId}`;

  const pickCover = (file: File | undefined) => {
    if (!file) return;
    const reason = coverRejectReason(file);
    if (reason) {
      toast.error(reason);
      return;
    }
    setCoverDraft(file);
  };

  const save = async () => {
    const t = title.trim();
    if (!t) {
      toast.error('A song needs a title');
      return;
    }
    const patch: { title?: string; artist?: string; album?: string } = {};
    if (t !== upload.title) patch.title = t;
    if (artist.trim() !== (upload.artist === 'Unknown artist' ? '' : upload.artist)) patch.artist = artist.trim();
    if (album.trim() !== (upload.album ?? '')) patch.album = album.trim();
    setBusy(true);
    try {
      if (Object.keys(patch).length > 0) await update.mutateAsync({ id: upload.sourceId, patch });
      if (cover instanceof File) await setCover.mutateAsync({ id: upload.sourceId, file: cover });
      else if (cover === 'removed' && upload.artworkUrl) await removeCover.mutateAsync(upload.sourceId);
      toast.success('Song updated');
      onClose();
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-block"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center justify-between gap-row">
        <h2 className="text-base font-bold">Edit song</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <CloseIcon className="size-5" />
        </Button>
      </div>

      <div className="flex items-center gap-block">
        <UploadCover src={shown} className="size-24 rounded-xl" />
        <div className="flex flex-col items-start gap-cluster">
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            <ImageUploadIcon />
            Upload cover
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!shown}
            onClick={() => setCoverDraft('removed')}
          >
            Remove cover
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Choose a cover image"
            className="hidden"
            onChange={(e) => {
              pickCover(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('title')}>Title</Label>
        <Input id={id('title')} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('artist')}>Artist</Label>
        <Input id={id('artist')} value={artist} maxLength={200} onChange={(e) => setArtist(e.target.value)} />
      </div>
      <div className="flex flex-col gap-cluster">
        <Label htmlFor={id('album')}>Album</Label>
        <Input
          id={id('album')}
          value={album}
          maxLength={200}
          placeholder="Optional"
          onChange={(e) => setAlbum(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatMb(upload.sizeBytes)} · added {formatAddedDate(upload.created)} · the file itself cannot change
      </p>

      <div className="flex justify-end gap-cluster">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="ember" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
