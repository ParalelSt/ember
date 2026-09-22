/** Screenshots and recordings attached to a bug report or a request. They go
 *  to Discord as real attachments on the same webhook message, so Discord's
 *  own limits are the limits here: a webhook message carries at most 10
 *  files and, on a server without boosts, 10 MB in total. Ember keeps to 4
 *  files (the dialogs have room for a row of 4) and the 10 MB total. */
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Images and video only: what a screenshot or a screen recording is. */
export const ATTACHMENT_ACCEPT = 'image/*,video/*';

export interface AttachmentLike {
  name: string;
  size: number;
  type: string;
}

/** "1.2 MB", "10 MB", "840 KB": at most one decimal for MB, none for KB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function totalBytes(files: AttachmentLike[]): number {
  return files.reduce((n, f) => n + f.size, 0);
}

export function isAllowedType(type: string): boolean {
  return type.startsWith('image/') || type.startsWith('video/');
}

/** Null when the set can be sent; otherwise the sentence the dialog shows
 *  (and the server returns), so the two can never disagree. */
export function attachmentProblem(files: AttachmentLike[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `Up to ${MAX_ATTACHMENTS} files per message.`;
  const bad = files.find((f) => !isAllowedType(f.type));
  if (bad) return `${bad.name} is not an image or a video.`;
  const total = totalBytes(files);
  if (total > MAX_ATTACHMENT_BYTES) {
    return `Files are ${formatBytes(total)}. Discord takes ${formatBytes(MAX_ATTACHMENT_BYTES)} per message: trim the clip or send fewer files.`;
  }
  return null;
}
