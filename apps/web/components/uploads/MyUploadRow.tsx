'use client';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EditIcon, MoreIcon, TrashIcon } from '@/components/icons';
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

/** One of your uploads: cover, title, "artist · size · date", and a ⋯ menu
 *  with Edit details and Remove. */
export function MyUploadRow({ upload, onEdit, onRemove }: Props) {
  return (
    <li data-testid="my-upload-row" className="flex items-center gap-row rounded-lg p-inset hover:bg-card">
      <UploadCover src={upload.artworkUrl} className="size-art-xs" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{upload.title}</div>
        <div className="truncate text-xs text-muted-foreground">{uploadMeta(upload)}</div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More options for ${upload.title}`}
          className="inline-flex size-hit shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreIcon className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => onEdit(upload)}>
            <EditIcon />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onRemove(upload)}>
            <TrashIcon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
