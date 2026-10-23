/** A touchscreen's coarse pointer, not a mouse. False during SSR or without
 *  matchMedia. */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}
