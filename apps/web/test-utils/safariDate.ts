/** A Date that reads only the ISO (T) form, as older Safari does: the space
 *  form PocketBase sends is Invalid Date. */
export function safariDate() {
  const Real = Date;
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d \d/.test(v) ? 'invalid' : v);
  class SafariDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super();
      else super(iso(args[0]) as string);
    }
    static parse(v: string) {
      return Real.parse(iso(v) as string);
    }
  }
  return SafariDate as unknown as DateConstructor;
}
