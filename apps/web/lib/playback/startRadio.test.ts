import { describe, expect, it } from 'vitest';
import { radioFromCurrent } from './startRadio';
import { makeTrack } from '@/test-utils/fakeBackend';

const A = makeTrack({ id: 'youtube:a' });
const B = makeTrack({ id: 'youtube:b' });
const C = makeTrack({ id: 'youtube:c' });

describe('radioFromCurrent', () => {
  it('keeps only the playing song, dropping what came before and after it', () => {
    expect(radioFromCurrent({ queue: [A, B, C], index: 1 }, B)).toEqual({
      queue: [B], index: 0, baseCount: 1, shuffle: false, orderBackup: null, radioHeldFor: null,
    });
  });
  it('is null for a song that is not the one playing (a fresh queue then)', () => {
    expect(radioFromCurrent({ queue: [A, B], index: 0 }, B)).toBeNull();
    expect(radioFromCurrent({ queue: [], index: -1 }, A)).toBeNull();
  });
});
