import { describe, expect, it } from 'vitest';
import { CloudArrowDownIcon, ClockIcon, FolderSimplePlusIcon } from '@/components/icons';
import { LIBRARY_BADGES } from './libraryIcons';

describe('LIBRARY_BADGES', () => {
  it('uses the picked icons', () => {
    expect(LIBRARY_BADGES.recent.icon).toBe(ClockIcon);
    expect(LIBRARY_BADGES.uploads.icon).toBe(FolderSimplePlusIcon);
    expect(LIBRARY_BADGES.downloaded.icon).toBe(CloudArrowDownIcon);
  });

  it('uses the warm palette for badge and tile', () => {
    expect(LIBRARY_BADGES.recent).toMatchObject({ color: '#f2514a', tile: 'linear-gradient(145deg, #f2514a, #3a0b1c)' });
    expect(LIBRARY_BADGES.uploads).toMatchObject({ color: '#e8912d', tile: 'linear-gradient(145deg, #e8912d, #3d1f06)' });
    expect(LIBRARY_BADGES.downloaded).toMatchObject({ color: '#d9547a', tile: 'linear-gradient(145deg, #d9547a, #33101f)' });
  });
});
