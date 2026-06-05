import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const url = req.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const q = (url.searchParams.get('q') ?? '').trim();
    const filter = q
      ? `title ~ "${pbEscape(q)}" || artist ~ "${pbEscape(q)}"`
      : '';

    const pb = await createAdminClient();
    const list = await pb.collection('tracks').getList(page, PAGE_SIZE, {
      sort: '-created',
      filter,
    });

    // Admin endpoint returns BOTH ids: `id` (Track.id = external_id, used in
    // the canonical Track shape everywhere else) and `recordId` (PB's
    // internal pkey used in PATCH/DELETE URLs below).
    const tracks = list.items
      .map((r) => {
        const mapped = mapTrackRow(r as unknown as TrackRecord);
        return mapped ? { ...mapped, recordId: r.id } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    return Response.json({
      tracks,
      page,
      totalPages: list.totalPages,
      totalItems: list.totalItems,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}

function pbEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
