import { describe, expect, it } from 'vitest';
import { CloudArrowDownIcon, ClockIcon, FolderSimplePlusIcon } from '@/components/icons';
import { LIBRARY_BADGES, LIKED_GRADIENT, NEUTRAL_COVER } from './libraryIcons';

describe('LIBRARY_BADGES', () => {
  it('keeps the current glyphs', () => {
    expect(LIBRARY_BADGES.recent.icon).toBe(ClockIcon);
    expect(LIBRARY_BADGES.uploads.icon).toBe(FolderSimplePlusIcon);
    expect(LIBRARY_BADGES.downloaded.icon).toBe(CloudArrowDownIcon);
  });

  it('gives each collection its own 135deg gradient (the owner\'s distinct pick)', () => {
    expect(LIBRARY_BADGES.recent.tile).toBe('linear-gradient(135deg, #246373, #88bfc3)');
    expect(LIBRARY_BADGES.uploads.tile).toBe('linear-gradient(135deg, #a16a2c, #e6c785)');
    expect(LIBRARY_BADGES.downloaded.tile).toBe('linear-gradient(135deg, #245d46, #80bba0)');
    expect(LIKED_GRADIENT).toEqual({ from: '#6544dc', to: '#b9c9ef' });
  });

  it('has a charcoal neutral tile with a soft gray note', () => {
    expect(NEUTRAL_COVER).toEqual({ background: '#232426', color: '#8c8e94' });
  });
});
