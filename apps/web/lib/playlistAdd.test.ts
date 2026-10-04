import { describe, expect, it } from 'vitest';
import { ClientResponseError } from 'pocketbase';
import { isAlreadyInPlaylist, isUniqueViolation } from './playlistAdd';

/** What the PocketBase SDK throws for the (playlist, track) unique index. */
const uniqueHit = () =>
  new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: 'Failed to create record.',
      data: {
        playlist: { code: 'validation_not_unique', message: 'Value must be unique.' },
        track: { code: 'validation_not_unique', message: 'Value must be unique.' },
      },
    },
  });

describe('isUniqueViolation', () => {
  it('spots the SDK error for the playlist_tracks unique index', () => {
    expect(isUniqueViolation(uniqueHit())).toBe(true);
  });

  it('spots it from the message alone, too', () => {
    expect(isUniqueViolation({ status: 400, data: { data: { track: { message: 'Value must be unique.' } } } })).toBe(true);
  });

  it('is not any other 400', () => {
    const other = new ClientResponseError({
      status: 400,
      response: { code: 400, message: 'Failed to create record.', data: { position: { code: 'validation_required', message: 'Missing required value.' } } },
    });
    expect(isUniqueViolation(other)).toBe(false);
    expect(isUniqueViolation({ status: 400 })).toBe(false);
    expect(isUniqueViolation({ status: 500 })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('isAlreadyInPlaylist (the app side)', () => {
  it('is the 409', () => {
    expect(isAlreadyInPlaylist(Object.assign(new Error('already in this playlist'), { status: 409 }))).toBe(true);
  });

  it('is the raw unique-index 400 an older server sends', () => {
    const e = Object.assign(
      new Error('Failed to create record. (playlist: Value must be unique.; track: Value must be unique.)'),
      { status: 400 },
    );
    expect(isAlreadyInPlaylist(e)).toBe(true);
  });

  it('is not another failure', () => {
    expect(isAlreadyInPlaylist(Object.assign(new Error('track required'), { status: 400 }))).toBe(false);
    expect(isAlreadyInPlaylist(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isAlreadyInPlaylist(new Error('offline'))).toBe(false);
    expect(isAlreadyInPlaylist(undefined)).toBe(false);
  });
});
