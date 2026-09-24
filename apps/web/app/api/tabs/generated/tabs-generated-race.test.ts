// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// M3: the GET must not answer "none" (204) while a POST is still awaiting the
// download (ensureDownloaded), before it ever reaches startGeneration. Unlike
// tabs-routes.test.ts, lib/tabGenerate is NOT mocked here — the race lives in
// its real generationStatus/pending bookkeeping, not in the job runner.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-generated-race-'));
process.env.MUSIC_DIR = musicDir;

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The download the POST awaits before it ever calls startGeneration: held
// open until the test releases it, so a GET can land squarely in that gap.
let releaseDownload: (() => void) | undefined;
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: () => new Promise<string>((resolve) => { releaseDownload = () => resolve('/tmp/audio.m4a'); }),
}));

const generated = await import('./[trackId]/route');

const ALICE = { id: 'alice', email: 'a@x', isAdmin: false };
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const trackCtx = (trackId: string) => ({ params: Promise.resolve({ trackId: encodeURIComponent(trackId) }) }) as never;

beforeEach(() => {
  store = fakePocketBase({ tabs: [], uploads: [], tracks: [], users: [] });
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: ALICE });
  releaseDownload = undefined;
  fs.rmSync(musicDir, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('GET /api/tabs/generated/[trackId] while a POST is still downloading', () => {
  it('answers "running", not "none", while ensureDownloaded is in flight', async () => {
    const trackId = 'youtube:AAAAAAAAAAA';
    const postDone = generated.POST(req(`/api/tabs/generated/${encodeURIComponent(trackId)}`, { method: 'POST' }), trackCtx(trackId));

    // Let the POST run up to (and start waiting on) ensureDownloaded before
    // polling — without the fix this is exactly the window that reads "none".
    await Promise.resolve();
    await Promise.resolve();

    const pollRes = await generated.GET(req(`/api/tabs/generated/${encodeURIComponent(trackId)}`), trackCtx(trackId));
    expect(pollRes.status).toBe(202);
    const body = await pollRes.json();
    expect(body.status).toBe('running');

    releaseDownload?.();
    const postRes = await postDone;
    expect(postRes.status).toBe(202);
  });
});
