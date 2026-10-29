'use client';

import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { EditIcon, MoreIcon, TrashIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { formatAddedDate } from '@/lib/format';
import { formatMb } from '@/lib/uploadQueue';
import type { MyUpload } from '@/types/track';
import { UploadCover } from './UploadCover';

/** "artist · size · date" under an upload's title. */
export function uploadMeta(u: MyUpload): string {
  return [u.artist, formatMb(u.sizeBytes), formatAddedDate(u.created)].filter(Boolean).join(' · ');
}

interface Props {
  upload: MyUpload;
  onEdit: (u: MyUpload) => void;
  onRemove: (u: MyUpload) => void;
}

const TRIGGER =
  'inline-flex size-hit shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/** One of your uploads: cover, title, "artist · size · date", and a ⋯ menu
 *  with Edit details and Remove. The menu is a sheet from the bottom on a
 *  phone (popups1, like the song menu), a dropdown on desktop. */
export function MyUploadRow({ upload, onEdit, onRemove }: Props) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const actions: MenuAction[] = [
    { key: 'edit', label: 'Edit details', icon: EditIcon, onSelect: () => onEdit(upload) },
    { key: 'remove', label: 'Remove', icon: TrashIcon, onSelect: () => onRemove(upload), destructive: true },
  ];
  const label = `More options for ${upload.title}`;

  return (
    <li data-testid="my-upload-row" className="flex items-center gap-row rounded-lg p-inset hover:bg-card">
      <UploadCover src={upload.artworkUrl} className="size-art-xs" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{upload.title}</div>
        <div className="truncate text-xs text-muted-foreground">{uploadMeta(upload)}</div>
      </div>
      {isDesktop ? (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={label} className={TRIGGER}>
            <MoreIcon className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {actions.map((a) => (
              <DropdownMenuItem
                key={a.key}
                variant={a.destructive ? 'destructive' : undefined}
                onClick={a.onSelect}
              >
                <a.icon />
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <button
            type="button"
            aria-label={label}
            aria-haspopup="dialog"
            className={TRIGGER}
            onClick={() => setOpen(true)}
          >
            <MoreIcon className="size-5" />
          </button>
          <ActionSheet
            open={open}
            onOpenChange={setOpen}
            title={`${upload.title} options`}
            header={
              <div className="flex min-w-0 items-center gap-row text-left">
                <UploadCover src={upload.artworkUrl} className="size-12" />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{upload.title}</div>
                  {upload.artist && <div className="truncate text-sm text-muted-foreground">{upload.artist}</div>}
                </div>
              </div>
            }
          >
            {actions.map((a) => (
              <ActionSheetItem
                key={a.key}
                icon={a.icon}
                tone={a.destructive ? 'destructive' : undefined}
                testId={`upload-menu-${a.key}`}
                onSelect={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                {a.label}
              </ActionSheetItem>
            ))}
          </ActionSheet>
        </>
      )}
    </li>
  );
}
