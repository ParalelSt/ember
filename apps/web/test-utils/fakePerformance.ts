/** A stand-in for the browser's PerformanceObserver and performance clock,
 *  for the perf log tests (lib/perf). Entries are pushed in by hand with
 *  emit(); the clock only moves when a test moves it. */

type Callback = (list: { getEntries: () => PerformanceEntry[] }) => void;

export interface FakeObserver {
  type?: string;
  options?: Record<string, unknown>;
  disconnected: boolean;
  cb: Callback;
}

export function makeFakePerformance(opts: { types?: string[]; memory?: boolean } = {}) {
  const observers: FakeObserver[] = [];
  const types = opts.types ?? ['long-animation-frame', 'longtask', 'event', 'paint', 'resource', 'navigation'];
  let clock = 0;
  const byType: Record<string, PerformanceEntry[]> = {};

  class FakePO {
    static supportedEntryTypes = types;
    private rec: FakeObserver;
    constructor(cb: Callback) {
      this.rec = { cb, disconnected: false };
      observers.push(this.rec);
    }
    observe(o: { type: string } & Record<string, unknown>) {
      this.rec.type = o.type;
      this.rec.options = o;
    }
    disconnect() {
      this.rec.disconnected = true;
    }
  }

  const perf = {
    now: () => clock,
    getEntriesByType: (t: string) => byType[t] ?? [],
    ...(opts.memory
      ? { memory: { usedJSHeapSize: 40 * 1024 * 1024, totalJSHeapSize: 60 * 1024 * 1024, jsHeapSizeLimit: 512 * 1024 * 1024 } }
      : {}),
  };

  return {
    PO: FakePO as unknown as typeof PerformanceObserver,
    perf: perf as unknown as Performance,
    observers,
    /** Delivers entries to every live observer of that type. */
    emit(type: string, entries: Record<string, unknown>[]) {
      for (const o of observers) {
        if (o.type === type && !o.disconnected) o.cb({ getEntries: () => entries as unknown as PerformanceEntry[] });
      }
    },
    /** What getEntriesByType(type) answers. */
    setEntries(type: string, entries: Record<string, unknown>[]) {
      byType[type] = entries as unknown as PerformanceEntry[];
    },
    setNow(ms: number) {
      clock = ms;
    },
    advance(ms: number) {
      clock += ms;
    },
    now: () => clock,
    live: () => observers.filter((o) => !o.disconnected),
  };
}

export type FakePerformance = ReturnType<typeof makeFakePerformance>;
