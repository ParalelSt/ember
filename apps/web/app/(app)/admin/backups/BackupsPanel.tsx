'use client';

import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { AlertIcon, DownloadIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useExecuteBackupNow, useQueryAdminBackups } from '@/hooks/useAdmin';
import { apiUrl } from '@/lib/api';
import { describeBackupSchedule } from '@/lib/backupSchedule';
import { formatBytes } from '@/lib/format';

/** Database backups (PocketBase's own, nightly by default) plus the member
 *  files that live outside the database. Listing, "Back up now" and the
 *  downloads all go through /api/admin/backups (admin only). No restore
 *  button on purpose: restoring replaces every account and playlist, so it
 *  stays a deliberate step in PocketBase's admin UI (see the note below and
 *  SETUP.md, "Backups"). */
export default function AdminBackupsPage() {
  const { data, isLoading, error } = useQueryAdminBackups();
  const backupNow = useExecuteBackupNow();

  const onBackupNow = () => {
    backupNow.mutate(undefined, {
      onSuccess: () => toast.success('Backup made'),
      onError: (e) => toast.error(`Couldn't back up: ${(e as Error).message}`),
    });
  };

  const schedule = data?.schedule ? describeBackupSchedule(data.schedule.cron, data.schedule.keep) : null;

  return (
    <section className="flex flex-col gap-section">
      <div>
        <SectionHeader
          title="Backups"
          className="mb-cluster"
          action={
            <Button variant="ember" onClick={onBackupNow} disabled={backupNow.isPending || isLoading}>
              {backupNow.isPending ? 'Backing up…' : 'Back up now'}
            </Button>
          }
        />
        <p className="text-sm text-muted-foreground">
          A backup is the whole database: accounts, playlists, likes, settings, avatars and playlist artwork.
          They are kept on this machine, so download one now and then and keep it somewhere else. A dead disk
          takes the backups on it along with everything else.
        </p>
      </div>

      {isLoading && <EmptyState>Loading…</EmptyState>}
      {error && <EmptyState>Couldn&apos;t load backups: {(error as Error).message}</EmptyState>}

      {data && (
        <>
          <div className="flex flex-col gap-cluster text-sm">
            {data.schedule && schedule && <p data-testid="backup-schedule">Automatic backups: {schedule}</p>}
            {data.schedule && !schedule && (
              <p data-testid="backup-schedule" className="text-destructive">
                Automatic backups are off. Turn them on in PocketBase&apos;s admin UI (Settings, Backups) or set
                EMBER_BACKUP_CRON and restart.
              </p>
            )}
            {data.schedule?.s3 && (
              <p className="text-muted-foreground">Backups are stored on S3 (set in PocketBase&apos;s admin UI).</p>
            )}
            {data.disk && (
              <p className="text-muted-foreground" data-testid="backup-disk">
                Free disk space: {formatBytes(data.disk.free)} of {formatBytes(data.disk.total)}
              </p>
            )}
            {data.disk?.low && (
              <div
                role="alert"
                className="flex gap-cluster items-start rounded-lg bg-destructive/10 text-destructive px-row py-cluster"
              >
                <AlertIcon className="h-4 w-4 mt-inset shrink-0" />
                <span>
                  Disk space is low. A backup may fail, and so may new songs and uploads. Free some space or
                  keep fewer backups (PocketBase admin UI, Settings, Backups).
                </span>
              </div>
            )}
          </div>

          <div>
            <SectionHeader title={`Database backups · ${data.backups.length}`} className="mb-row" />
            {data.backups.length === 0 && <EmptyState>No backups yet. Make one with Back up now.</EmptyState>}
            <ul className="flex flex-col gap-cluster">
              {data.backups.map((b) => (
                <li
                  key={b.name}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-row items-center px-row py-cluster rounded-lg bg-card"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{b.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {new Date(b.modified).toLocaleString()} · {formatBytes(b.size)} · {b.auto ? 'automatic' : 'manual'}
                    </div>
                  </div>
                  <a
                    href={apiUrl(`/api/admin/backups/${encodeURIComponent(b.name)}`)}
                    download={b.name}
                    className={buttonVariants({ variant: 'outline' })}
                    aria-label={`Download ${b.name}`}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SectionHeader title="Member files" className="mb-cluster" />
            <p className="text-sm text-muted-foreground mb-row">
              Uploaded songs and their covers, tabs and prank sounds are stored next to the music, not in the
              database, so the backups above do not include them. Download them here as one archive. Cached
              YouTube songs are left out: they download again the next time someone plays them.
            </p>
            <div className="flex items-center gap-row flex-wrap">
              <a
                href={apiUrl('/api/admin/backups/member-files')}
                className={buttonVariants({ variant: 'outline' })}
              >
                <DownloadIcon className="h-4 w-4" />
                Download member files
              </a>
              <span className="text-sm text-muted-foreground tabular-nums" data-testid="member-files">
                {data.memberFiles.files} {data.memberFiles.files === 1 ? 'file' : 'files'},{' '}
                {formatBytes(data.memberFiles.bytes)} before compression
              </span>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            <SectionHeader title="Restoring" className="mb-cluster" />
            <p className="mb-cluster">
              Restoring replaces everything in the database with the backup, so it is not a button here. On the
              host, open PocketBase&apos;s admin UI at http://127.0.0.1:8090/_/ (Settings, Backups) and choose
              Restore on a backup. PocketBase restarts with it.
            </p>
            <p>
              From a downloaded copy: stop Ember, move pocketbase/pb_data aside, unzip the backup into a new
              pocketbase/pb_data and start Ember again. For member files, unpack the archive and copy its
              folders into the music folder (MUSIC_DIR). SETUP.md, &ldquo;Backups&rdquo;, has the details.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
