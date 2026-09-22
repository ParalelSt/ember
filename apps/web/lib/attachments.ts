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

/** The multipart field the dialogs put each file under, next to a `payload`
 *  field holding the JSON body they would otherwise send on its own. */
export const ATTACHMENT_FIELD = 'attachments';
export const PAYLOAD_FIELD = 'payload';

/** The file part of every `attachments` entry in a posted form (a string
 *  entry, which a hand-written request could send, is not a file). */
export function formAttachments(form: FormData): File[] {
  return form.getAll(ATTACHMENT_FIELD).filter((v): v is File => typeof v !== 'string');
}

/** The name a file goes to Discord under: the original basename, reduced to
 *  safe characters, so Discord still sees the extension and renders an image
 *  inline or a clip as a player. Falls back to `attachment-N`. */
export function safeAttachmentName(name: string, index: number): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-100);
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : `attachment-${index + 1}`;
}

/** True when Discord refused a message for its size: a 413, or a 400 with
 *  its "Request entity too large" error (code 40005). Only then is it worth
 *  sending the message again without the reporter's files. */
export function isTooLargeForDiscord(status: number, body: string): boolean {
  if (status === 413) return true;
  return status === 400 && (/\b40005\b/.test(body) || /entity too large/i.test(body));
}

/** What the dialogs say when the message went out without its files. */
export const ATTACHMENTS_DROPPED_TOAST = 'Sent, but the attachments were too big for Discord';

/** The embed field that stands in for files Discord would not take, so the
 *  message still says something was attached. */
export function droppedAttachmentsField(files: AttachmentLike[]): { name: string; value: string; inline: false } {
  const n = files.length;
  return {
    name: 'Attachments',
    value: `${n} file${n === 1 ? '' : 's'}, ${formatBytes(totalBytes(files))}, too big for Discord, not included`,
    inline: false,
  };
}
