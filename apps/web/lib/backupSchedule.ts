/** Plain words for PocketBase's backup schedule, for the admin Backups
 *  section. The common "M H * * *" becomes "every night at HH:MM UTC" (the
 *  zone PocketBase's cron runs in, whatever the host's own); anything else
 *  is shown as the cron line itself. */
export function describeBackupSchedule(cron: string, keep: number): string | null {
  const c = cron.trim();
  if (!c) return null;
  const keeps = keep > 0 ? `, keeping the last ${keep}` : '';
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(c);
  if (m && Number(m[1]) < 60 && Number(m[2]) < 24) {
    const hh = m[2].padStart(2, '0');
    const mm = m[1].padStart(2, '0');
    return `Every night at ${hh}:${mm} UTC${keeps}.`;
  }
  return `On the schedule "${c}"${keeps}.`;
}
