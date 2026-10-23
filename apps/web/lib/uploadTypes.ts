/** Accepted upload audio types -> canonical extension. Anything else is
 *  rejected: the uploads directory is served back to every member, so it
 *  holds audio only. Kept apart from lib/uploads (server only) so the
 *  browser's own check before an upload (lib/uploadQueue) uses the same
 *  list as the server. */
export const ALLOWED_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.m4a',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
};
