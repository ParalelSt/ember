import { describe, expect, it } from 'vitest';
import { ClientResponseError } from 'pocketbase';
import { isUniqueHit } from './uniqueHit';

/** What the PocketBase 0.22 SDK throws when a unique index refuses a create. */
const uniqueError = (...fields: string[]) =>
  new ClientResponseError({
    status: 400,
    response: {
      code: 400,
      message: 'Failed to create record.',
      data: Object.fromEntries(fields.map((f) => [f, { code: 'validation_not_unique', message: 'Value must be unique.' }])),
    },
  });

describe('isUniqueHit', () => {
  it('is the unique-index 400, on any field of the index', () => {
    expect(isUniqueHit(uniqueError('user', 'track'))).toBe(true);
    expect(isUniqueHit(uniqueError('email'))).toBe(true);
    expect(isUniqueHit({ status: 400, data: { data: { track: { message: 'Value must be unique.' } } } })).toBe(true);
  });

  it('can be limited to the fields of one index', () => {
    expect(isUniqueHit(uniqueError('email'), ['email'])).toBe(true);
    expect(isUniqueHit(uniqueError('external_id'), ['email'])).toBe(false);
  });

  it('is not any other 400', () => {
    const badRelation = new ClientResponseError({
      status: 400,
      response: {
        code: 400,
        message: 'Failed to create record.',
        data: { track: { code: 'validation_missing_rel_records', message: 'Failed to find all relation records with the provided ids.' } },
      },
    });
    expect(isUniqueHit(badRelation)).toBe(false);
    expect(isUniqueHit(new ClientResponseError({ status: 400, response: { code: 400, message: 'Failed to create record.', data: {} } }))).toBe(false);
    expect(isUniqueHit({ status: 400 })).toBe(false);
    expect(isUniqueHit({ status: 500 })).toBe(false);
    expect(isUniqueHit(null)).toBe(false);
  });
});
