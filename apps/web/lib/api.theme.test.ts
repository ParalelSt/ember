import { afterEach, describe, expect, it, vi } from 'vitest';

const error = vi.fn();
const warn = vi.fn();
vi.mock('@/lib/logger/client', () => ({ logger: { error: (...a: unknown[]) => error(...a), warn: (...a: unknown[]) => warn(...a) } }));

const { api } = await import('@/lib/api');

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  error.mockReset();
  warn.mockReset();
});

describe('api theme calls', () => {
  it('sends the selection and returns the stored doc', async () => {
    respond(200, { v: 1, preset: 'mono' });
    expect(await api.setTheme({ preset: 'mono' })).toEqual({ v: 1, preset: 'mono' });
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('/api/theme');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ preset: 'mono' });
  });

  it('treats an unreadable refusal as an answer: a warning, with the findings on the error', async () => {
    const body = { error: 'Fix the readability problems to save', findings: [{ pair: 'accent', label: 'Accent links on the background', ratio: 1.2 }] };
    respond(422, body);
    const err = (await api.createTheme({ name: 'Murky', base: 'midnight', inputs: {} as never }).catch((e) => e)) as Error & { status: number; body: unknown };
    expect(err.status).toBe(422);
    expect(err.message).toBe('Fix the readability problems to save');
    expect(err.body).toEqual(body);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('still logs an unexpected failure as an error', async () => {
    respond(500, { error: 'boom' });
    await expect(api.listThemes()).rejects.toThrow('boom');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('addresses one theme by its encoded id', async () => {
    respond(200, { ok: true });
    await api.deleteSavedTheme('abc/def');
    expect((fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe('/api/themes/abc%2Fdef');
  });
});
