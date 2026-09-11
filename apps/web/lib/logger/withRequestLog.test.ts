import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// createClient talks to next/headers' cookies(), which throws outside a
// real request scope. The wrapper only needs it for best-effort userId
// resolution, so stub it the same way every call site would see "no user".
vi.mock('@/lib/pocketbase/server', () => ({
  createClient: vi.fn(async () => ({ authStore: { record: null } })),
}));

// Spy on the append instead of hitting the filesystem: same as any other
// serverLogger call site would want in a unit test.
vi.mock('./server', () => ({
  serverLogger: { error: vi.fn(), warn: vi.fn() },
}));

import { withRequestLog } from './withRequestLog';
import { serverLogger } from './server';

function makeReq(headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request('http://localhost/api/test', { method, headers });
}

const errorSpy = vi.mocked(serverLogger.error);
const warnSpy = vi.mocked(serverLogger.warn);

beforeEach(() => {
  errorSpy.mockClear();
  warnSpy.mockClear();
});

describe('withRequestLog', () => {
  it('reuses the x-request-id request header as reqId when present', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const wrapped = withRequestLog('test/route', handler);
    await wrapped(makeReq({ 'x-request-id': 'abc123' }) as never, {});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, , , , ctx] = errorSpy.mock.calls[0];
    expect(ctx).toMatchObject({ reqId: 'abc123', route: 'test/route' });
  });

  it('a thrown error logs an error entry with route/reqId and returns 500 JSON', async () => {
    const handler = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const wrapped = withRequestLog('boom/route', handler);
    const res = await wrapped(makeReq() as never, {});

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [category, message, data, err, ctx] = errorSpy.mock.calls[0];
    expect(category).toBe('api');
    expect(message).toBe('kaboom');
    expect(data).toMatchObject({ durationMs: expect.any(Number) });
    expect(err).toBeInstanceOf(Error);
    expect(ctx).toMatchObject({ route: 'boom/route' });
    expect((ctx as { reqId: string }).reqId).toBeTruthy();
  });

  it('a 502 with a JSON error body is logged at warn', async () => {
    const handler = vi.fn(async () => Response.json({ error: 'upstream failed' }, { status: 502 }));
    const wrapped = withRequestLog('stream/route', handler);
    const res = await wrapped(makeReq() as never, {});

    expect(res.status).toBe(502);
    // The response body must still be readable by the caller: the wrapper
    // only clones to inspect it, never consumes the original.
    expect(await res.json()).toEqual({ error: 'upstream failed' });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [category, , data] = warnSpy.mock.calls[0];
    expect(category).toBe('api');
    expect(data).toMatchObject({ status: 502, error: 'upstream failed' });
  });

  it('a 200 response logs nothing', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const wrapped = withRequestLog('quiet/route', handler);
    const res = await wrapped(makeReq() as never, {});

    expect(res.status).toBe(200);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a 429 logs a warn with route and userId', async () => {
    const handler = vi.fn(async () => Response.json({ error: 'rate limited' }, { status: 429 }));
    const wrapped = withRequestLog('limited/route', handler);
    await wrapped(makeReq() as never, {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [category, message, data, , ctx] = warnSpy.mock.calls[0];
    expect(category).toBe('api');
    expect(message).toContain('429');
    expect(data).toMatchObject({ status: 429 });
    expect(ctx).toMatchObject({ route: 'limited/route' });
  });

  it('a 4xx other than 429 is not logged', async () => {
    const handler = vi.fn(async () => Response.json({ error: 'bad request' }, { status: 400 }));
    const wrapped = withRequestLog('quiet400/route', handler);
    await wrapped(makeReq() as never, {});

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('records durationMs on every logged entry', async () => {
    const handler = vi.fn(async () => Response.json({ error: 'fail' }, { status: 500 }));
    const wrapped = withRequestLog('slow/route', handler);
    await wrapped(makeReq() as never, {});

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, , data] = errorSpy.mock.calls[0];
    expect(data).toMatchObject({ durationMs: expect.any(Number) });
  });

  it('generates a reqId when no x-request-id header is present', async () => {
    const handler = vi.fn(async () => Response.json({ error: 'fail' }, { status: 500 }));
    const wrapped = withRequestLog('noheader/route', handler);
    await wrapped(makeReq() as never, {});

    const [, , , , ctx] = errorSpy.mock.calls[0];
    expect((ctx as { reqId: string }).reqId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// Every apps/web/app/api/**/route.ts handler export must be wrapped in
// withRequestLog: otherwise a new route silently opts out of server-side
// request logging and triage loses correlation for it. Mirrors the scan
// style used by lintRules.test.ts.
describe('every API route handler is wrapped in withRequestLog', () => {
  const API_ROOT = join(__dirname, '..', '..', 'app', 'api');
  const METHOD_RE = /^export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;

  function findRouteFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) findRouteFiles(full, out);
      else if (entry === 'route.ts') out.push(full);
    }
    return out;
  }

  const routeFiles = findRouteFiles(API_ROOT);

  it('found route files to check (sanity check the scan itself works)', () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  for (const file of routeFiles) {
    const rel = file.slice(API_ROOT.length + 1);
    it(`${rel} wraps every handler export in withRequestLog`, () => {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const exportLines = lines.filter((l) => METHOD_RE.test(l.trim()));
      expect(exportLines.length, `no GET/POST/etc export found in ${rel}`).toBeGreaterThan(0);
      for (const line of exportLines) {
        expect(line, `handler export not wrapped in withRequestLog:\n${line}`).toMatch(
          /=\s*withRequestLog\(/,
        );
      }
    });
  }
});

describe('withRequestLog and non-JSON bodies', () => {
  it('returns a streamed 5xx body untouched instead of parsing it', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ab'));
        controller.close();
      },
    });
    const handler = async () => new Response(stream, { status: 502, headers: { 'content-type': 'audio/mp4' } });
    const wrapped = withRequestLog('stream-test', handler);
    const res = await wrapped(makeReq() as never, {});
    expect(res.status).toBe(502);
    // the wrapper neither consumed nor cloned the body
    expect(res.bodyUsed).toBe(false);
    expect(await res.text()).toBe('ab');
  });
});

