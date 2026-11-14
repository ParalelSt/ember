'use client';

import { PlusIcon, UploadIcon } from '@/components/icons';
import { SectionHeader } from '@/components/page/SectionHeader';
import { EmptyState } from '@/components/page/EmptyState';
import { UploadDropZone } from '@/components/uploads/UploadDropZone';
import { UploadProgressCard } from '@/components/uploads/UploadProgressCard';
import { MyUploadRow } from '@/components/uploads/MyUploadRow';
import { UPLOADS_SHARED_TEXT, UploadsDialogs, useUploadsSettings } from '@/components/settings/useUploadsSettings';
import { TransferCard } from '@/components/settings/PhoneLibraryCards';
import { formatCount } from '@/lib/format';

/** Settings > Uploads on a phone and narrow windows (desktop draws the
 *  same as rows, components/settings/desktop/UploadsSection), library
 *  first: the header, a red Upload songs bar that opens a compact drop
 *  zone, one combined progress card while songs go up, then your own
 *  uploads as compact rows with Edit details and Remove. Everyone's uploads
 *  stay playable as the Uploads collection in Library and Home. */
export default function UploadsPage() {
  const s = useUploadsSettings();
  const { user, desktop, queue, items, uploads, isLoading, isError, dropOpen, setDropOpen, setEditing, setRemoving, addFiles } = s;

  if (!user) return <EmptyState>Sign in to upload songs</EmptyState>;

  return (
    <section className="flex flex-col gap-block">
      <header>
        <SectionHeader title="Uploads" />
        <p className="text-meta">{UPLOADS_SHARED_TEXT}</p>
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

      <TransferCard />

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

      <UploadsDialogs s={s} />
    </section>
  );
}
