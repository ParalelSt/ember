'use client';

import { Button } from '@/components/ui/button';
import { PlusIcon, UploadIcon } from '@/components/icons';
import { UploadDropZone } from '@/components/uploads/UploadDropZone';
import { UploadProgressCard } from '@/components/uploads/UploadProgressCard';
import { MyUploadRow } from '@/components/uploads/MyUploadRow';
import { UPLOADS_SHARED_TEXT, UploadsDialogs, useUploadsSettings } from '@/components/settings/useUploadsSettings';
import { formatCount } from '@/lib/format';
import { SettingsGroup, SettingsRow } from './rows';

/** Desktop Settings > Uploads as rows: the same queue, list, edit and
 *  remove as the phone page (app/(app)/settings/uploads). */
export function UploadsSection() {
  const s = useUploadsSettings();
  const { user, queue, items, uploads, isLoading, isError, dropOpen, setDropOpen, setEditing, setRemoving, addFiles } = s;

  if (!user) {
    return (
      <SettingsGroup>
        <SettingsRow title="Sign in to upload songs" />
      </SettingsGroup>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <SettingsGroup title="Add music" footer={UPLOADS_SHARED_TEXT}>
        <SettingsRow
          title="Upload songs"
          description="Audio files from this computer, several at once."
          control={
            <Button variant="ember" aria-expanded={dropOpen} aria-controls="upload-drop" onClick={() => setDropOpen((o) => !o)}>
              <PlusIcon className="size-4" />
              Upload songs
            </Button>
          }
        />
        {dropOpen && (
          <div id="upload-drop">
            <UploadDropZone desktop onFiles={addFiles} />
          </div>
        )}
        <UploadProgressCard items={items} onRetryFailed={queue.retryFailed} onCancelAll={queue.cancelAll} onClear={queue.clear} />
      </SettingsGroup>

      <SettingsGroup
        title="Your uploads"
        aside={<span className="text-xs text-muted-foreground">{formatCount(uploads.length, 'song')}</span>}
      >
        {isLoading && uploads.length === 0 ? (
          <SettingsRow title={<span className="font-normal text-muted-foreground">Loading…</span>} />
        ) : isError && uploads.length === 0 ? (
          <SettingsRow title={<span className="font-normal text-muted-foreground">Couldn&apos;t load your uploads. Please try again.</span>} />
        ) : uploads.length === 0 ? (
          <SettingsRow
            leading={
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <UploadIcon className="size-5" />
              </span>
            }
            title="Nothing uploaded yet"
            description="Add songs from your device and everyone on this server can play them."
            control={
              <Button variant="outline" onClick={() => setDropOpen(true)}>
                Add songs
              </Button>
            }
          />
        ) : (
          <ul aria-label="Your uploads" className="-mx-inset flex flex-col">
            {uploads.map((u) => (
              <MyUploadRow key={u.id} upload={u} onEdit={setEditing} onRemove={setRemoving} />
            ))}
          </ul>
        )}
      </SettingsGroup>

      <UploadsDialogs s={s} />
    </div>
  );
}
