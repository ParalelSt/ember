import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { warn },
}));

// Reset modules between tests so checkTriageConfig re-reads
// process.env.ANTHROPIC_API_KEY fresh each time (isTriageConfigured() reads
// it live, but keeping the pattern consistent with other env-driven tests).
describe('checkTriageConfig', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warn.mockClear();
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    consoleWarn.mockRestore();
  });

  it('warns nowhere when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const { checkTriageConfig } = await import('./triage');
    checkTriageConfig();
    expect(warn).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('warns via serverLogger and console when ANTHROPIC_API_KEY is empty', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const { checkTriageConfig } = await import('./triage');
    checkTriageConfig();
    const message = 'ANTHROPIC_API_KEY is not set: bug reports will arrive without AI triage';
    expect(warn).toHaveBeenCalledWith('ai', message);
    expect(consoleWarn).toHaveBeenCalledWith(`[triage] ${message}`);
  });
});
