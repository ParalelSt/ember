// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { generatorStatus, cachedGeneratorStatus, readCheck, resetGeneratorStatus, TOOLS_TTL_MS } = await import('./tabGenerate');
const { friendlyGenerateError, isToolsMissing, TOOLS_MISSING_MESSAGE } = await import('./tabToolsText');

beforeEach(() => resetGeneratorStatus());

describe('can this host generate tabs?', () => {
  it('reads transcribe.py --check', () => {
    expect(readCheck({ code: 0, stdout: 'noise\n{"ok": false, "missing": ["basic_pitch", 3]}\n' })).toEqual({
      available: false,
      missing: ['basic_pitch'],
    });
    expect(readCheck({ code: 0, stdout: '{"ok": true, "missing": []}' })).toEqual({ available: true, missing: [] });
    expect(readCheck({ code: 1, stdout: 'Traceback' })).toBeNull();
    expect(readCheck({ code: 0, stdout: '{"missing": []}' })).toBeNull();
  });

  it('asks once, and keeps the answer for a while (not forever: installing needs no restart)', async () => {
    let t = 1_000;
    const run = vi.fn(async () => ({ code: 0, stdout: '{"ok": false, "missing": ["basic_pitch"]}' }));
    const now = () => t;
    const [a, b] = await Promise.all([generatorStatus({ run, now }), generatorStatus({ run, now })]);
    expect(a).toEqual({ available: false, missing: ['basic_pitch'] });
    expect(b).toEqual(a);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cachedGeneratorStatus(now)).toEqual(a);
    t += TOOLS_TTL_MS + 1;
    expect(cachedGeneratorStatus(now)).toBeNull();
    run.mockResolvedValueOnce({ code: 0, stdout: '{"ok": true, "missing": []}' });
    expect(await generatorStatus({ run, now })).toEqual({ available: true, missing: [] });
  });

  it('a check with no answer does not block (the job says what failed)', async () => {
    expect(await generatorStatus({ run: async () => ({ code: null, stdout: '' }) })).toEqual({ available: true, missing: [] });
  });
});

describe('the words for it', () => {
  it('turns a missing module into the message, and leaves other failures alone', () => {
    expect(isToolsMissing("ModuleNotFoundError: No module named 'basic_pitch'")).toBe(true);
    expect(isToolsMissing('no module basic pitch')).toBe(true);
    expect(isToolsMissing('transcription timed out')).toBe(false);
    expect(friendlyGenerateError("No module named 'librosa'")).toBe(TOOLS_MISSING_MESSAGE);
    expect(friendlyGenerateError('transcription timed out')).toBe('transcription timed out');
    expect(friendlyGenerateError(null)).toBeNull();
  });
});
