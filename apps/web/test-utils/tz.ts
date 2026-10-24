import { afterAll, beforeAll } from 'vitest';

/** Runs the enclosing describe block in `zone` (Node reads TZ again on
 *  every change) and puts the zone back afterwards. An unset TZ is deleted
 *  again rather than set to the string "undefined", which Node would read
 *  as UTC for every later test in the same worker. */
export function pinTz(zone: string): void {
  let before: string | undefined;
  beforeAll(() => {
    before = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  });
}
