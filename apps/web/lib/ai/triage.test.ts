import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTriageConfig, resetTriageConfigNote, summarizeDigest, triageBugReport, type TriageInput } from './triage';

const { error, warn, info } = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error, warn, info },
}));

const MISSING_KEY = 'ANTHROPIC_API_KEY is not set: bug reports will arrive without AI triage';

const INPUT: TriageInput = {
  note: 'it stopped',
  client: { current: [], previous: [], sessionId: 'session-1' },
  server: [],
  userAgent: 'test-agent',
  context: undefined,
};

// isTriageConfigured() reads process.env.ANTHROPIC_API_KEY live, so each
// test only needs a fresh "missing key already noted" flag.
const original = process.env.ANTHROPIC_API_KEY;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetTriageConfigNote();
  error.mockClear();
  warn.mockClear();
  info.mockClear();
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = original;
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
});

describe('checkTriageConfig', () => {
  it('logs nothing when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    checkTriageConfig();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('notes a missing ANTHROPIC_API_KEY at info (a setting, not a fault) and on the console', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    checkTriageConfig();
    expect(info).toHaveBeenCalledWith('ai', MISSING_KEY);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(`[triage] ${MISSING_KEY}`);
  });
});

describe('triageBugReport without a key', () => {
  it('notes the missing key once at info, however many reports arrive, and never logs an error', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await triageBugReport(INPUT)).toBeNull();
    expect(await triageBugReport(INPUT)).toBeNull();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('ai', MISSING_KEY);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not repeat the startup note on the first report', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    checkTriageConfig();
    await triageBugReport(INPUT);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('notes it again after resetTriageConfigNote (the test hook)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await triageBugReport(INPUT);
    resetTriageConfigNote();
    await triageBugReport(INPUT);
    expect(info).toHaveBeenCalledTimes(2);
  });
});

describe('a failed triage call', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  });

  it('logs a thrown call (timeout, network) at warn, kept out of the digest, not at error', async () => {
    const boom = new Error('network down');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(boom)));
    expect(await triageBugReport(INPUT)).toBeNull();
    expect(warn).toHaveBeenCalledWith('ai', 'triage failed', { digest: false }, boom);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a refused call (HTTP error) at warn, kept out of the digest, not at error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('overloaded', { status: 529 })));
    expect(await triageBugReport(INPUT)).toBeNull();
    expect(warn).toHaveBeenCalledWith('ai', 'triage HTTP 529', { detail: 'overloaded', digest: false });
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an empty answer at warn, kept out of the digest, not at error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ content: [] })));
    expect(await triageBugReport(INPUT)).toBeNull();
    expect(warn).toHaveBeenCalledWith('ai', 'triage returned no text', { digest: false });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('a failed digest summary call', () => {
  it('logs at warn, kept out of the digest, not at error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const boom = new Error('timeout');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(boom)));
    expect(await summarizeDigest('1x  api  /x  first 01:00 last 01:00  e.g. boom', 1)).toBeNull();
    expect(warn).toHaveBeenCalledWith('ai', 'digest summary failed', { digest: false }, boom);
    expect(error).not.toHaveBeenCalled();
  });
});
