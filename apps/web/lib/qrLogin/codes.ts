/** The short code a person types to approve a QR sign-in (plan 2a): 8
 *  symbols of Crockford base32, which leaves out I, L, O and U so nothing
 *  reads as something else. 32^8 = 2^40 codes, alive 3 minutes.
 *
 *  Pure, no crypto: the code input on the approving device uses these too.
 *  Making a code is server-only (lib/qrLogin/secrets.ts). */

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** True for an already-normalised code: 8 symbols of the alphabet. */
export function isCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

/** What the person typed, as a code: upper case, dashes and spaces dropped,
 *  O read as 0 and I or L as 1 (Crockford's own reading). null when it is
 *  not 8 symbols of the alphabet. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_‐-―]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return isCode(cleaned) ? cleaned : null;
}

/** ABCDEFGH -> ABCD-EFGH, for reading aloud and typing. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
