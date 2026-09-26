import { describe, expect, it } from 'vitest';
import { describeBackupSchedule } from './backupSchedule';

describe('describeBackupSchedule', () => {
  it('reads the nightly default as a time of day', () => {
    expect(describeBackupSchedule('0 4 * * *', 7)).toBe('Every night at 04:00 (server time), keeping the last 7.');
    expect(describeBackupSchedule('30 23 * * *', 3)).toBe('Every night at 23:30 (server time), keeping the last 3.');
  });

  it('shows any other schedule as the cron line', () => {
    expect(describeBackupSchedule('0 */6 * * *', 10)).toBe('On the schedule "0 */6 * * *", keeping the last 10.');
    expect(describeBackupSchedule('0 4 * * 1', 4)).toBe('On the schedule "0 4 * * 1", keeping the last 4.');
  });

  it('is null when automatic backups are off', () => {
    expect(describeBackupSchedule('', 7)).toBeNull();
    expect(describeBackupSchedule('   ', 7)).toBeNull();
  });

  it('leaves the keep count out when there is none', () => {
    expect(describeBackupSchedule('0 4 * * *', 0)).toBe('Every night at 04:00 (server time).');
  });
});
