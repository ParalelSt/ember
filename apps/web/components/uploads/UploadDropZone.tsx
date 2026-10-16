'use client';

import { useRef, useState, type DragEvent } from 'react';
import { UploadIcon } from '@/components/icons';
import { MAX_UPLOAD_MB, UPLOAD_ACCEPT } from '@/lib/uploadQueue';
import { cn } from '@/lib/utils';

/** The compact drop zone the Upload songs bar opens: drop songs on it on a
 *  desktop, tap it to choose files anywhere. Several at once. */
export function UploadDropZone({ desktop, onFiles }: { desktop: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="upload-drop-zone"
      aria-label={desktop ? 'Drop songs here or browse files' : 'Tap to choose songs'}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-inset rounded-2xl border-2 border-dashed border-ember/40 bg-ember/5 p-block text-center text-ember transition-colors',
        'hover:bg-ember/10 focus-visible:outline-2 focus-visible:outline-ring',
        over && 'border-ember bg-ember/15',
      )}
    >
      <span className="flex items-center gap-cluster">
        <UploadIcon className="size-5" />
        <span className="text-sm font-semibold text-foreground">{desktop ? 'Drop songs here' : 'Tap to choose songs'}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        mp3, m4a, flac, ogg, opus, wav. Up to {MAX_UPLOAD_MB} MB each.{desktop ? ' Or click to browse.' : ''}
      </span>
      <input
        ref={input}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        aria-label="Choose songs"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
