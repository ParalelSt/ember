'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/components/providers/AuthProvider';
import { EditUploadSheet } from '@/components/uploads/EditUploadSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { useMyUploadActions, useQueryMyUploads } from '@/hooks/useMyUploads';
import type { MyUpload } from '@/types/track';

/* Settings > Uploads, shared by the phone page (app/(app)/settings/uploads)
 * and the desktop rows section (components/settings/desktop): the same
 * queue, list, edit and remove. */

export const UPLOADS_SHARED_TEXT = 'Songs you add here are shared with everyone on this server. Only you can edit or remove yours.';

export function useUploadsSettings() {
  const { user } = useAuth();
  const desktop = useIsDesktop();
  const { queue, items } = useUploadQueue();
  const { data: uploads = [], isLoading, isError } = useQueryMyUploads();
  const { remove } = useMyUploadActions();
  const [dropOpen, setDropOpen] = useState(false);
  const [editing, setEditing] = useState<MyUpload | null>(null);
  const [removing, setRemoving] = useState<MyUpload | null>(null);

  const addFiles = (files: File[]) => {
    queue.add(files);
    setDropOpen(false);
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.sourceId);
      toast.success(`Removed "${removing.title}"`);
      setRemoving(null);
    } catch (e) {
      toast.error(`Couldn't remove: ${(e as Error).message}`);
      throw e;
    }
  };

  return {
    user,
    desktop,
    queue,
    items,
    uploads,
    isLoading,
    isError,
    dropOpen,
    setDropOpen,
    editing,
    setEditing,
    removing,
    setRemoving,
    addFiles,
    confirmRemove,
  };
}

/** Edit details and "Remove ...?", opened from an upload's ... menu. */
export function UploadsDialogs({ s }: { s: ReturnType<typeof useUploadsSettings> }) {
  return (
    <>
      <EditUploadSheet upload={s.editing} desktop={s.desktop} onClose={() => s.setEditing(null)} />

      <ConfirmDialog
        open={s.removing !== null}
        onOpenChange={(o) => !o && s.setRemoving(null)}
        title={s.removing ? `Remove "${s.removing.title}"?` : ''}
        description="Removes the song for everyone on the server. This cannot be undone."
        confirmLabel="Remove"
        cancelLabel="Keep"
        variant="destructive"
        onConfirm={s.confirmRemove}
      />
    </>
  );
}
