'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AttachIcon, CloseIcon, VideoIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
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

/** "Attach screenshot or video" plus a row of thumbnails, each with a remove
 *  button, and the running total (or what is wrong) underneath. Controlled:
 *  the dialog owns the files, and checks attachmentProblem() before Send. */
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
      {files.length > 0 && (
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
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={add}
        hidden
        data-testid="attachment-input"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled || files.length >= MAX_ATTACHMENTS}
        onClick={() => inputRef.current?.click()}
      >
        <AttachIcon />
        Attach screenshot or video
      </Button>
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
          {files.length} of {MAX_ATTACHMENTS} files, {formatBytes(totalBytes(files))} of{' '}
          {formatBytes(MAX_ATTACHMENT_BYTES)}
        </p>
      )}
    </div>
  );
}
