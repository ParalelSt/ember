import { beforeEach, describe, expect, it, vi } from 'vitest';

const warnSpy = vi.fn();
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { warn: (...args: unknown[]) => warnSpy(...args) },
}));

const { isOptionalDepMissing, warnOptionalDepsOnce, resetOptionalDepsWarning } = await import('./tabOptionalDeps');

beforeEach(() => {
  warnSpy.mockClear();
  resetOptionalDepsWarning();
});

describe('isOptionalDepMissing', () => {
  it('recognises a missing numpy as an optional-dep failure', () => {
    expect(isOptionalDepMissing("ModuleNotFoundError: No module named 'numpy'")).toBe(true);
  });

  it('recognises a missing basic_pitch as an optional-dep failure', () => {
    expect(isOptionalDepMissing("ModuleNotFoundError: No module named 'basic_pitch'")).toBe(true);
  });

  it('does not treat an unrelated failure as an optional-dep failure', () => {
    expect(isOptionalDepMissing('could not decode the audio: broken')).toBe(false);
    expect(isOptionalDepMissing("ModuleNotFoundError: No module named 'yt_dlp'")).toBe(false);
  });
});

describe('warnOptionalDepsOnce', () => {
  it('logs one warn the first time, and stays silent on later calls in the same process', () => {
    warnOptionalDepsOnce();
    warnOptionalDepsOnce();
    warnOptionalDepsOnce();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('tabs', 'tab alignment is off: numpy/basic_pitch not installed, see SETUP.md');
  });
});
