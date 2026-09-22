import { vi } from 'vitest';
import type { SpeechEvents } from '@/lib/speech/types';

/** SpeechEvents made of typed spies, for the lib/speech adapter tests. */
export function makeFakeSpeechEvents() {
  return {
    onPartial: vi.fn<SpeechEvents['onPartial']>(),
    onFinal: vi.fn<SpeechEvents['onFinal']>(),
    onError: vi.fn<SpeechEvents['onError']>(),
    onEnd: vi.fn<SpeechEvents['onEnd']>(),
  };
}
