'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CloseIcon, PlusIcon, VideoIcon } from '@/components/icons';
import {
  ATTACHMENT_ACCEPT,
  attachmentProblem,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  totalBytes,
} from '@/lib/attachments';

// A stable React key per File: removing one file must not remount (and so
// re-read) the thumbnails after it.
const fileIds = new WeakMap<File, number>();
let nextFileId = 0;
function fileKey(file: File): number {
  let id = fileIds.get(file);
  if (id === undefined) {
    id = nextFileId++;
    fileIds.set(file, id);
  }
  return id;
}

/** An object URL for the file, revoked when the thumbnail goes away. */
function useObjectUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external resource created and revoked with the effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A 56px square preview: the image itself, or the clip's first frame with
 *  a film badge and its length once the metadata has loaded. */
function Thumb({ file }: { file: File }) {
  const url = useObjectUrl(file);
  const [duration, setDuration] = useState<number | null>(null);
  const video = file.type.startsWith('video/');
  const image = file.type.startsWith('image/');
  return (
    <div
      data-testid="attach-thumb"
      data-kind={video ? 'video' : image ? 'image' : 'other'}
      title={`${file.name}, ${formatBytes(file.size)}`}
      className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted"
    >
      {url && image && (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise
        <img src={url} alt={file.name} className="size-full object-cover" />
      )}
      {url && video && (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-label={file.name}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
          className="size-full object-cover"
        />
      )}
      {!image && !video && (
        <span className="flex size-full items-center justify-center px-inset text-center text-[10px] break-all text-muted-foreground">
          {file.name.split('.').pop()}
        </span>
      )}
      {video && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-inset bg-black/60 px-inset text-[10px] text-white">
          <VideoIcon className="size-3" />
          {duration !== null && <span data-testid="attach-duration">{formatDuration(duration)}</span>}
        </span>
      )}
    </div>
  );
}

interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** A row of square tiles: the thumbnails, each with a remove button, then a
 *  same-size plus that opens the file picker (gone at the maximum). The
 *  running total, or what is wrong, sits underneath. Controlled: the dialog
 *  owns the files, and checks attachmentProblem() before Send. */
export function AttachmentPicker({ files, onChange, disabled }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const problem = attachmentProblem(files);

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Cleared so picking the same file again (after removing it) still fires.
    e.target.value = '';
    if (picked.length === 0) return;
    onChange([...files, ...picked].slice(0, MAX_ATTACHMENTS));
  };

  return (
    <div data-testid="attachment-picker" className="flex flex-col gap-cluster">
      <div className="flex flex-wrap gap-cluster">
        {files.map((f, i) => (
          <div key={fileKey(f)} className="relative">
            <Thumb file={f} />
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              disabled={disabled}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
            >
              <CloseIcon className="size-3" />
            </button>
          </div>
        ))}
        {files.length < MAX_ATTACHMENTS && (
          <button
            type="button"
            data-testid="attach-add"
            aria-label="Attach screenshot or video"
            title="Attach screenshot or video"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ember disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="size-5" />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={add}
        hidden
        data-testid="attachment-input"
      />
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Optional. Up to {MAX_ATTACHMENTS} images or clips, {formatBytes(MAX_ATTACHMENT_BYTES)} in total.
        </p>
      ) : problem ? (
        <p data-testid="attach-problem" className="text-xs text-destructive">
          {problem}
        </p>
      ) : (
        <p data-testid="attach-summary" className="text-xs text-muted-foreground">
          {files.length} of {MAX_ATTACHMENTS} · {formatBytes(totalBytes(files))} of {formatBytes(MAX_ATTACHMENT_BYTES)}
        </p>
      )}
    </div>
  );
}
