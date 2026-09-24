import { describe, expect, it } from 'vitest';
import { themeFromRecord } from '@/lib/theme/fromRecord';
import { DEFAULT_THEME } from '@/lib/theme/model';

const full = { id: 'u1', email: 'a@b.c', collectionId: 'c', collectionName: 'users', created: '2026-01-01', verified: true };

describe('themeFromRecord', () => {
  it('reads the theme off a full users record', () => {
    expect(themeFromRecord({ ...full, theme: { v: 1, preset: 'nebula' } })).toEqual({ v: 1, preset: 'nebula' });
  });

  it('is the default for a record that never saved a theme, or saved junk', () => {
    expect(themeFromRecord({ ...full, theme: null })).toEqual(DEFAULT_THEME);
    expect(themeFromRecord(full)).toEqual(DEFAULT_THEME);
    expect(themeFromRecord({ ...full, theme: 'midnight' })).toEqual(DEFAULT_THEME);
  });

  it('is null when signed out or when the SDK stripped the record for size', () => {
    expect(themeFromRecord(null)).toBeNull();
    expect(themeFromRecord(undefined)).toBeNull();
    // What exportToCookie keeps when the cookie would pass 4096 bytes.
    expect(themeFromRecord({ id: 'u1', email: 'a@b.c', collectionId: 'c', collectionName: 'users', verified: true })).toBeNull();
  });
});
