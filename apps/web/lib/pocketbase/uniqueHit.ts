/** PocketBase 0.22's answer to a unique-index hit on create: a 400 whose
 *  field errors say `validation_not_unique` ("Value must be unique.") on
 *  the index's columns. The SDK error keeps the body in `.response` (`.data`
 *  is the same object), the field errors one level further down, in its
 *  `data`. Any other 400 (a missing relation, a failed create rule, a hook's
 *  refusal) is a real failure, not "already there".
 *
 *  `fields` limits the check to one index's columns; by default any field
 *  counts. */
export function isUniqueHit(e: unknown, fields?: readonly string[]): boolean {
  if ((e as { status?: number } | null | undefined)?.status !== 400) return false;
  const err = e as { response?: { data?: unknown }; data?: { data?: unknown } };
  const raw = err.response?.data ?? err.data?.data;
  if (!raw || typeof raw !== 'object') return false;
  const errors = raw as Record<string, { code?: unknown; message?: unknown } | null | undefined>;
  return (fields ?? Object.keys(errors)).some((f) => {
    const info = errors[f];
    if (!info || typeof info !== 'object') return false;
    return info.code === 'validation_not_unique' || (typeof info.message === 'string' && /must be unique/i.test(info.message));
  });
}
