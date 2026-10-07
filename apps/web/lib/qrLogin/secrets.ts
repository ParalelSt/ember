import 'server-only';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH } from './codes';

/** A fresh short code from the CSPRNG (crypto.randomInt, no modulo bias). */
export function newShortCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** 32 random bytes as base64url (43 chars): the approve token and the poll
 *  secret. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** True for something shaped like newSecret()'s output. */
export function isSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** sha256 as base64url. Only hashes are stored, never the secrets. */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Constant-time comparison of two hashes. Empty never matches. */
export function sameHash(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
