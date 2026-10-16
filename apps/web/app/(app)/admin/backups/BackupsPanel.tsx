'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { AlertIcon, DownloadIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useExecuteBackupNow, useQueryAdminBackups } from '@/hooks/useAdmin';
import { apiUrl } from '@/lib/api';
import { describeBackupSchedule } from '@/lib/backupSchedule';
import { formatBytes } from '@/lib/format';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export default function BackupsPanel() {
  const { data, isLoading, error } = useQueryAdminBackups();
  const backupNow = useExecuteBackupNow();
  const isDesktop = useIsDesktop();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onBackupNow = () => {
    backupNow.mutate(undefined, {
      onSuccess: () => toast.success('Backup made'),
      onError: (e) => toast.error(`Couldn't back up: ${(e as Error).message}`),
    });
  };

  const schedule = data?.schedule ? describeBackupSchedule(data.schedule.cron, data.schedule.keep) : null;

  return (
    // pb-stack: room under the last card for the phone's floating button.
    <section className="flex flex-col gap-section pb-stack md:pb-0">
      <div>
        <SectionHeader
          title="Backups"
          className="mb-cluster"
          action={
            // Phone: the floating Back up now below instead.
            <Button
              variant="ember"
              className="hidden md:inline-flex"
              onClick={() => setConfirmOpen(true)}
              disabled={backupNow.isPending || isLoading}
            >
              {backupNow.isPending ? 'Backing up…' : 'Back up now'}
            </Button>
          }
        />
        <p className="text-sm text-muted-foreground">
          Database backups include accounts, playlists, likes, settings and artwork. Keep a copy off this server.
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
                Automatic backups are off. Enable them in PocketBase → Settings → Backups.
              </p>
            )}
            {!data.schedule && <p data-testid="backup-schedule">Automatic backups: status unavailable.</p>}
            {data.schedule?.s3 && (
              <p className="text-muted-foreground">Backups are stored on S3.</p>
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
                  Disk space is low. Free space or reduce backup retention in PocketBase to avoid failed backups and uploads.
                </span>
              </div>
            )}
          </div>

          <div>
            <SectionHeader title={`Database backups · ${data.backups.length}`} className="mb-row" />
            {data.backups.length === 0 && <EmptyState>No backups yet. Make one with Back up now.</EmptyState>}
            <ul aria-label="Database backups" className="flex flex-col gap-cluster">
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

          <div className="rounded-2xl bg-card p-stack shadow-soft">
            <SectionHeader title="Member files" className="mb-cluster" />
            <p className="text-sm text-muted-foreground mb-row">
              Download uploaded songs, covers, tabs and prank sounds separately from the database, excluding cached YouTube songs.
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

          <div className="rounded-2xl bg-card p-stack shadow-soft text-sm text-muted-foreground">
            <SectionHeader title="Restoring" className="mb-cluster" />
            <p className="mb-row">Restoring replaces the entire database.</p>
            <ol aria-label="Restore steps" className="list-decimal pl-stack space-y-cluster">
              <li>
                In PocketBase → Settings → Backups, choose Restore; for a downloaded copy, use Upload backup first.
                PocketBase restarts automatically.
              </li>
              <li>
                For a manual restore instead, stop Ember, move <code>pocketbase/pb_data</code> aside,
                unzip the backup into a new <code>pocketbase/pb_data</code>, then restart Ember.
              </li>
              <li>
                Extract the member files archive and copy the folders inside <code>ember-files/</code> into
                your music folder (<code>MUSIC_DIR</code>).
              </li>
            </ol>
            <a
              href="https://github.com/ParalelSt/ember/blob/main/SETUP.md#backups"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-row inline-block underline underline-offset-4 hover:text-foreground"
            >
              SETUP.md: Backups
            </a>
          </div>
        </>
      )}

      {isDesktop && (
        <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen}
          title="Back up now?" description="This saves the whole database on this machine. It takes a few seconds."
          confirmLabel="Back up now" onConfirm={onBackupNow} />
      )}

      {!isDesktop && (
        <FloatingActionButton
          label={backupNow.isPending ? 'Backing up…' : 'Back up now'}
          onClick={onBackupNow}
          disabled={backupNow.isPending || isLoading}
        />
      )}
    </section>
  );
}
