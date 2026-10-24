/** How many days of server logs (logs/errors-YYYY-MM-DD.jsonl) are kept:
 *  the sweep in lib/logger/server.ts deletes older files. Anything that looks
 *  back through the logs (the bug report's "Seen before") can see this far
 *  and no further. No server-only import, so the wording can share it. */
export const LOG_RETENTION_DAYS = 2;
export const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
