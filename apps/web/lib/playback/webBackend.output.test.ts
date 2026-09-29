import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebBackend } from './webBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({
  logger: { breadcrumb: vi.fn(), error: vi.fn() },
}));

// The output device on web audio (lib/outputs): the element's setSinkId,
// and the audio context's too once the equalizer's graph exists, because
// the element then plays into the context and its own sink stops counting.

class FakeNode {
  connect(n: FakeNode) {
    return n;
  }
}
class FakeFilter extends FakeNode {
  type = '';
  frequency = { value: 0 };
  Q = { value: 0 };
  gain = { value: 0 };
}
class FakeGain extends FakeNode {
  gain = { value: 1 };
}
let contexts: FakeContext[] = [];
class FakeContext {
  sampleRate = 48000;
  destination = new FakeNode();
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  setSinkId = vi.fn(async (id: string) => void id);
  constructor() {
    contexts.push(this);
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createGain() {
    return new FakeGain();
  }
}

const element = () => document.body.querySelector('audio') as unknown as { setSinkId?: unknown };
const BASS = { enabled: true, bands: [6, 0, 0, 0, 0] };

beforeEach(() => {
  contexts = [];
  vi.stubGlobal('AudioContext', FakeContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.querySelectorAll('audio').forEach((a) => a.remove());
});

describe('webBackend: output device', () => {
  it('sends the element to the chosen device and remembers it', async () => {
    const b = createWebBackend(makeFakeEvents());
    const setSinkId = vi.fn(async () => {});
    element().setSinkId = setSinkId;
    expect(b.outputDevice?.()).toBe('');
    await b.setOutputDevice!('usb-dac');
    expect(setSinkId).toHaveBeenCalledWith('usb-dac');
    expect(b.outputDevice?.()).toBe('usb-dac');
    b.destroy();
  });

  it('keeps the old device when the browser refuses the new one', async () => {
    const b = createWebBackend(makeFakeEvents());
    element().setSinkId = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    await expect(b.setOutputDevice!('elsewhere')).rejects.toThrow();
    expect(b.outputDevice?.()).toBe('');
    b.destroy();
  });

  it('says so in a browser without setSinkId', async () => {
    const b = createWebBackend(makeFakeEvents());
    element().setSinkId = undefined;
    await expect(b.setOutputDevice!('x')).rejects.toThrow(/cannot pick/);
    b.destroy();
  });

  it('moves the equalizer graph too, whether it was built before or after the choice', async () => {
    const b = createWebBackend(makeFakeEvents());
    element().setSinkId = vi.fn(async () => {});
    await b.setOutputDevice!('headset');
    // Built after: the new context starts on the chosen device.
    b.setEq!(BASS);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].setSinkId).toHaveBeenCalledWith('headset');
    // Built before: a later choice moves the context as well.
    await b.setOutputDevice!('');
    expect(contexts[0].setSinkId).toHaveBeenLastCalledWith('');
    b.destroy();
  });
});
