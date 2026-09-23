'use client';

import type { ReactNode } from 'react';
import { AttachIcon, CloseIcon, ImageUploadIcon, VideoIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  attachmentProblem,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  totalBytes,
} from '@/lib/attachments';
import {
  ATTACH_RECOMMENDED,
  ATTACH_STYLES,
  MOCK_ATTACHMENTS,
  type AttachState,
  type AttachStyle,
  type MockAttachment,
} from '@/components/library/options/attachments';

/** A square preview: the image itself, or the clip's first frame with its
 *  length, drawn here as a gradient stand-in. */
function Thumb({ file, size = 'lg' }: { file: MockAttachment; size?: 'lg' | 'sm' }) {
  const video = file.type.startsWith('video/');
  return (
    <div
      data-testid="attach-thumb"
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md bg-linear-to-br',
        file.swatch,
        size === 'lg' ? 'size-14' : 'size-10',
      )}
    >
      {video && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-inset bg-black/60 px-inset text-[10px] text-white">
          <VideoIcon className="size-3" />
          {file.duration}
        </span>
      )}
    </div>
  );
}

function RemoveButton({ name }: { name: string }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
    >
      <CloseIcon className="size-3" />
    </button>
  );
}

/** "2 of 4 files, 7.6 MB of 10 MB", or the problem in destructive red. */
function Summary({ files }: { files: MockAttachment[] }) {
  const problem = attachmentProblem(files);
  if (problem) return <p data-testid="attach-problem" className="text-xs text-destructive">{problem}</p>;
  return (
    <p className="text-xs text-muted-foreground">
      {files.length} of {MAX_ATTACHMENTS} files, {formatBytes(totalBytes(files))} of{' '}
      {formatBytes(MAX_ATTACHMENT_BYTES)}
    </p>
  );
}

function ChipsAttach({ files }: { files: MockAttachment[] }) {
  return (
    <div className="flex flex-col gap-cluster">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-cluster">
          {files.map((f) => (
            <div key={f.name} className="relative">
              <Thumb file={f} />
              <RemoveButton name={f.name} />
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start">
        <AttachIcon />
        Attach screenshot or video
      </Button>
      {files.length > 0 ? (
        <Summary files={files} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Optional. Up to {MAX_ATTACHMENTS} images or clips, {formatBytes(MAX_ATTACHMENT_BYTES)} in total.
        </p>
      )}
    </div>
  );
}

function DropzoneAttach({ files }: { files: MockAttachment[] }) {
  return (
    <div className="flex flex-col gap-cluster">
      <div className="flex flex-col items-center gap-inset rounded-lg border border-dashed border-foreground/20 px-block py-block text-center">
        <ImageUploadIcon className="size-5 text-muted-foreground" />
        <p className="text-sm">
          Drop screenshots or a clip here, or <span className="text-ember underline">browse</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_ATTACHMENTS} files, {formatBytes(MAX_ATTACHMENT_BYTES)} in total
        </p>
      </div>
      {files.map((f) => (
        <div key={f.name} className="flex items-center gap-row">
          <Thumb file={f} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{f.name}</div>
            <div className="text-xs text-muted-foreground">{formatBytes(f.size)}</div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`}>
            <CloseIcon />
          </Button>
        </div>
      ))}
      {files.length > 0 && <Summary files={files} />}
    </div>
  );
}

/** Footer style: the strip above the footer (only with files); the paperclip
 *  itself is passed into the footer by MockDialog. */
function FooterStrip({ files }: { files: MockAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-cluster">
      <div className="flex flex-wrap gap-cluster">
        {files.map((f) => (
          <div key={f.name} className="relative">
            <Thumb file={f} size="sm" />
            <RemoveButton name={f.name} />
          </div>
        ))}
      </div>
      <Summary files={files} />
    </div>
  );
}

function AttachUi({ style, files }: { style: AttachStyle; files: MockAttachment[] }) {
  if (style === 'chips') return <ChipsAttach files={files} />;
  if (style === 'dropzone') return <DropzoneAttach files={files} />;
  return <FooterStrip files={files} />;
}

/** The dialog chrome as it ships (DialogContent, DialogHeader and
 *  DialogFooter's classes), drawn in place instead of in a portal so it can
 *  sit in the gallery. */
function MockDialog({
  title,
  description,
  style,
  files,
  sendLabel,
  children,
}: {
  title: string;
  description: string;
  style: AttachStyle;
  files: MockAttachment[];
  sendLabel: string;
  children: ReactNode;
}) {
  const blocked = attachmentProblem(files) !== null;
  return (
    <div
      data-testid="attach-dialog"
      className="grid w-full max-w-md gap-block rounded-xl bg-popover p-block text-sm text-popover-foreground ring-1 ring-foreground/10"
    >
      <div className="flex flex-col gap-cluster">
        <div className="font-heading text-base leading-none font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-block">
        {children}
        <AttachUi style={style} files={files} />
      </div>
      <div className="-mx-block -mb-block flex items-center gap-cluster rounded-b-xl border-t bg-muted/50 p-block">
        {style === 'footer' && (
          <Button type="button" variant="ghost" size="icon" aria-label="Attach screenshot or video" className="mr-auto">
            <AttachIcon />
          </Button>
        )}
        <div className="ml-auto flex gap-cluster">
          <Button type="button" variant="ghost">Cancel</Button>
          <Button type="button" disabled={blocked} variant="ember">
            {sendLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FakeField({ label, value, tall }: { label: string; value: string; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-cluster">
      <div className="text-sm font-medium">{label}</div>
      <div
        className={cn(
          'rounded-lg border border-input px-row py-cluster text-sm text-foreground/90',
          tall && 'min-h-20',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Both forms in one style: Send a request on its Fix tab, and Report a
 *  bug, each with the attach UI where that style puts it. */
function StyleRow({ style, state }: { style: AttachStyle; state: AttachState }) {
  const files = state === 'empty' ? [] : MOCK_ATTACHMENTS[state];
  return (
    <div className="grid grid-cols-1 items-start gap-stack lg:grid-cols-2">
      <MockDialog
        title="Send a request"
        description="New features and fixes go to the project's Discord, each to its own channel."
        style={style}
        files={files}
        sendLabel="Send"
      >
        <div className="grid grid-cols-2 rounded-lg bg-muted p-inset text-center text-sm">
          <div className="py-inset text-muted-foreground">New feature</div>
          <div className="rounded-md bg-background py-inset">Fix</div>
        </div>
        <FakeField label="Name" value="Queue jumps to the top" />
        <FakeField
          label="Recommended approach"
          value="When I remove a song the queue scrolls back to the top. It should stay where I was."
          tall
        />
      </MockDialog>
      <MockDialog
        title="Report a bug"
        description="Sends diagnostic logs to the host's Discord channel along with your note."
        style={style}
        files={files}
        sendLabel="Send report"
      >
        <FakeField label="What happened?" value="Skipping a song made the player go silent." tall />
      </MockDialog>
    </div>
  );
}

/** Every attach style, each drawn in both forms, all in the same state. */
export function AttachmentsSection({ state }: { state: AttachState }) {
  return (
    <div data-testid="attachments-section" className="flex flex-col gap-section">
      {ATTACH_STYLES.map((s) => (
        <div key={s.id} data-testid="attach-style" data-style={s.id}>
          <div className="mb-cluster flex items-center gap-row">
            <div className="text-eyebrow">{s.label}</div>
            {s.id === ATTACH_RECOMMENDED && (
              <span className="rounded-full bg-ember/15 px-row text-xs font-medium text-ember">Recommended</span>
            )}
          </div>
          <p className="text-meta mb-block max-w-3xl">{s.blurb}</p>
          <StyleRow style={s.id} state={state} />
        </div>
      ))}
    </div>
  );
}
