import { describe, expect, it } from 'vitest';
import { fileUrl } from './fileUrl';

describe('fileUrl', () => {
  it('builds a same-origin /pb URL from collectionId, record id, and filename', () => {
    const record = { id: 'rec1', collectionId: 'col123', collectionName: 'users' };
    expect(fileUrl(record, 'avatar.png')).toBe('/pb/api/files/col123/rec1/avatar.png');
  });

  it('falls back to collectionName when collectionId is missing', () => {
    const record = { id: 'rec1', collectionName: 'users' };
    expect(fileUrl(record, 'avatar.png')).toBe('/pb/api/files/users/rec1/avatar.png');
  });

  it('URL-encodes the collection, id, and filename', () => {
    const record = { id: 'rec 1', collectionName: 'my col' };
    expect(fileUrl(record, 'my avatar.png')).toBe(
      '/pb/api/files/my%20col/rec%201/my%20avatar.png',
    );
  });

  it('appends query params when given', () => {
    const record = { id: 'rec1', collectionName: 'users' };
    expect(fileUrl(record, 'avatar.png', { thumb: '100x100' })).toBe(
      '/pb/api/files/users/rec1/avatar.png?thumb=100x100',
    );
  });

  it('returns null with no filename', () => {
    const record = { id: 'rec1', collectionName: 'users' };
    expect(fileUrl(record, '')).toBeNull();
    expect(fileUrl(record, null)).toBeNull();
  });

  it('returns null with no record id', () => {
    expect(fileUrl({ collectionName: 'users' }, 'avatar.png')).toBeNull();
  });

  it('returns null with neither collectionId nor collectionName', () => {
    expect(fileUrl({ id: 'rec1' }, 'avatar.png')).toBeNull();
  });

  it('returns null for a null/undefined record', () => {
    expect(fileUrl(null, 'avatar.png')).toBeNull();
    expect(fileUrl(undefined, 'avatar.png')).toBeNull();
  });
});
