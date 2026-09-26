import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebBackend } from './webBackend';
import { autoPreampDb } from './eq';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({
  logger: { breadcrumb: vi.fn(), error: vi.fn() },
}));

// The equalizer on web audio: BiquadFilterNodes between the element and the
// speakers, built only once it is switched on (the graph costs a phone its
// background playback), and the element's own volume path left alone.

/** A node that remembers what it was connected to. */
class FakeNode {
  out: FakeNode[] = [];
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
  }
}
class FakeParam {
  constructor(public value: number) {}
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}
class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

let contexts: FakeContext[] = [];
class FakeContext {
  sampleRate = 44100;
  destination = new FakeNode();
  source: FakeNode | null = null;
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createMediaElementSource() {
    this.source = new FakeNode();
    return this.source;
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createGain() {
    return new FakeGain();
  }
  /** The nodes from the element to the speakers, in order. */
  chain(): FakeNode[] {
    const out: FakeNode[] = [];
    let n = this.source;
    while (n && n.out.length) {
      n = n.out[0];
      out.push(n);
    }
    return out;
  }
}

const element = () => document.body.querySelector('audio') as HTMLAudioElement;
const BASS = { enabled: true, bands: [7, 4, 0, 0, 0] };

beforeEach(() => {
  contexts = [];
  vi.stubGlobal('AudioContext', FakeContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.querySelectorAll('audio').forEach((a) => a.remove());
});

describe('webBackend equalizer', () => {
  it('off or flat builds nothing: the element plays bare', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setEq!({ enabled: false, bands: [6, 0, 0, 0, 6] });
    b.setEq!({ enabled: true, bands: [0, 0, 0, 0, 0] });
    expect(contexts).toHaveLength(0);
    b.destroy();
  });

  it('switched on, the element goes through five filters and a pre-amp to the speakers', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setEq!(BASS);
    expect(contexts).toHaveLength(1);
    const ctx = contexts[0];
    expect(ctx.resume).toHaveBeenCalled();
    const chain = ctx.chain();
    // 5 filters, the eq pre-amp, the party gain, the speakers.
    expect(chain).toHaveLength(8);
    const filters = chain.slice(0, 5) as FakeFilter[];
    expect(filters.map((f) => f.type)).toEqual(['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf']);
    expect(filters.map((f) => f.frequency.value)).toEqual([60, 230, 910, 3600, 14000]);
    expect(filters.every((f) => f.Q.value === 1)).toBe(true);
    expect(filters.map((f) => f.gain.value)).toEqual([7, 4, 0, 0, 0]);
    const pre = chain[5] as FakeGain;
    expect(pre.gain.value).toBeCloseTo(Math.pow(10, autoPreampDb(BASS.bands, 44100) / 20), 6);
    expect(pre.gain.value).toBeLessThan(1);
    expect((chain[6] as FakeGain).gain.value).toBe(1);
    expect(chain[7]).toBe(ctx.destination);
    b.destroy();
  });

  it('a change retunes the same graph; off puts it back to flat at unity', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setEq!(BASS);
    b.setEq!({ enabled: true, bands: [0, 0, 3, 5, 0] });
    b.setEq!({ enabled: false, bands: [0, 0, 3, 5, 0] });
    expect(contexts).toHaveLength(1);
    const chain = contexts[0].chain();
    expect((chain.slice(0, 5) as FakeFilter[]).map((f) => f.gain.value)).toEqual([0, 0, 0, 0, 0]);
    expect((chain[5] as FakeGain).gain.value).toBe(1);
    b.setEq!({ enabled: true, bands: [0, 0, 3, 5, 0] });
    expect((chain.slice(0, 5) as FakeFilter[]).map((f) => f.gain.value)).toEqual([0, 0, 3, 5, 0]);
    b.destroy();
  });

  it('keeps the element volume path: the slider curve times normalization', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setEq!(BASS);
    b.setVolume(0.64, { normGain: 0.5 });
    expect(element().volume).toBeCloseTo(0.256, 5);
    expect((contexts[0].chain()[6] as FakeGain).gain.value).toBe(1);
    b.destroy();
  });

  it('party mode shares the one graph: its gain stays apart from the eq pre-amp', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(0.8, { gain: 2, normGain: 0.5 });
    expect(contexts).toHaveLength(1);
    b.setEq!(BASS);
    expect(contexts).toHaveLength(1);
    const chain = contexts[0].chain();
    expect((chain[6] as FakeGain).gain.value).toBe(1);
    expect((chain[5] as FakeGain).gain.value).toBeLessThan(1);
    expect((chain[0] as FakeFilter).gain.value).toBe(7);
    b.destroy();
  });

  it('party mode built first starts with the equalizer flat when it is off', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(0.8, { gain: 2 });
    const chain = contexts[0].chain();
    expect((chain.slice(0, 5) as FakeFilter[]).every((f) => f.gain.value === 0)).toBe(true);
    expect((chain[5] as FakeGain).gain.value).toBe(1);
    b.destroy();
  });

  it('a browser without Web Audio just plays unequalized', () => {
    vi.stubGlobal('AudioContext', undefined);
    const b = createWebBackend(makeFakeEvents());
    expect(() => b.setEq!(BASS)).not.toThrow();
    b.destroy();
  });
});
