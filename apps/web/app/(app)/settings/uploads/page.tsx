'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon, UploadIcon } from '@/components/icons';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionHeader } from '@/components/page/SectionHeader';
import { EmptyState } from '@/components/page/EmptyState';
import { useAuth } from '@/components/providers/AuthProvider';
import { UploadDropZone } from '@/components/uploads/UploadDropZone';
import { UploadProgressCard } from '@/components/uploads/UploadProgressCard';
import { MyUploadRow } from '@/components/uploads/MyUploadRow';
import { EditUploadSheet } from '@/components/uploads/EditUploadSheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { useMyUploadActions, useQueryMyUploads } from '@/hooks/useMyUploads';
import { formatCount } from '@/lib/format';
import type { MyUpload } from '@/types/track';

/** Settings > Uploads, library first (the owner's pick, phone and desktop
 *  alike): the header, a red Upload songs bar that opens a compact drop
 *  zone, one combined progress card while songs go up, then your own
 *  uploads as compact rows with Edit details and Remove. Everyone's uploads
 *  stay playable as the Uploads collection in Library and Home. */
export default function UploadsPage() {
  const { user } = useAuth();
  const desktop = useIsDesktop();
  const { queue, items } = useUploadQueue();
  const { data: uploads = [], isLoading, isError } = useQueryMyUploads();
  const { remove } = useMyUploadActions();
  const [dropOpen, setDropOpen] = useState(false);
  const [editing, setEditing] = useState<MyUpload | null>(null);
  const [removing, setRemoving] = useState<MyUpload | null>(null);

  if (!user) return <EmptyState>Sign in to upload songs</EmptyState>;

  const addFiles = (files: File[]) => {
    queue.add(files);
    setDropOpen(false);
  };

  return (
    <section className="flex flex-col gap-block">
      <header>
        <SectionHeader title="Uploads" />
        <p className="text-meta">
          Songs you add here are shared with everyone on this server. Only you can edit or remove yours.
        </p>
      </header>

      <button
        type="button"
        aria-expanded={dropOpen}
        aria-controls="upload-drop"
        onClick={() => setDropOpen((o) => !o)}
        className="flex items-center justify-center gap-cluster rounded-full bg-ember p-row font-semibold text-ember-foreground transition-colors hover:bg-ember-soft"
      >
        <PlusIcon className="size-4" />
        Upload songs
      </button>
      {dropOpen && (
        <div id="upload-drop">
          <UploadDropZone desktop={desktop} onFiles={addFiles} />
        </div>
      )}

      <UploadProgressCard
        items={items}
        onRetryFailed={queue.retryFailed}
        onCancelAll={queue.cancelAll}
        onClear={queue.clear}
      />

      <div className="flex flex-col gap-cluster">
        <div className="flex items-baseline justify-between gap-row">
          <h3 className="text-base font-bold">Your uploads</h3>
          <span className="text-xs text-muted-foreground">{formatCount(uploads.length, 'song')}</span>
        </div>
        {isLoading && uploads.length === 0 ? (
          <p className="text-meta">Loading…</p>
        ) : isError && uploads.length === 0 ? (
          <p className="text-meta">Couldn&apos;t load your uploads. Please try again.</p>
        ) : uploads.length === 0 ? (
          <EmptyState
            icon={<UploadIcon />}
            title="Nothing uploaded yet"
            action={{ label: 'Add songs', onClick: () => setDropOpen(true) }}
          >
            Add songs from your device and everyone on this server can play them.
          </EmptyState>
        ) : (
          <ul aria-label="Your uploads" className="flex flex-col">
            {uploads.map((u) => (
              <MyUploadRow key={u.id} upload={u} onEdit={setEditing} onRemove={setRemoving} />
            ))}
          </ul>
        )}
      </div>

      <EditUploadSheet upload={editing} desktop={desktop} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove "${removing.title}"?` : ''}
        description="Removes the song for everyone on the server. This cannot be undone."
        confirmLabel="Remove"
        cancelLabel="Keep"
        variant="destructive"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.sourceId);
            toast.success(`Removed "${removing.title}"`);
            setRemoving(null);
          } catch (e) {
            toast.error(`Couldn't remove: ${(e as Error).message}`);
            throw e;
          }
        }}
      />
    </section>
  );
}
