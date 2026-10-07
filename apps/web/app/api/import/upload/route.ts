import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { createAdminClient } from '@/lib/pocketbase/server';
import { createImportJob } from '@/lib/import/store';
import { kickImportRunner } from '@/lib/import/runnerInstance';
import {
  isParseError,
  parseTransferInput,
  SAMPLE_SIZE,
  tooLarge,
  TOO_LARGE_MESSAGE,
  type ParsedSource,
} from '@/lib/import/sources/index';
import { isAlreadyLiked, splitAlreadyLiked, type LikedIndex } from '@/lib/import/alreadyLiked';
import { likedIndexFor } from '@/lib/import/likedSongs';
import { jobSourceFor } from '@/lib/import/sources/types';
import { ALL_LIKED_MESSAGE, OVER_CAP_MESSAGE } from '@/lib/import/transferCopy';
import type { JobKind } from '@/lib/import/types';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Songs from a file or a pasted list, on their way into the likes (the
 *  transfer plan, sections 2.6 and 3).
 *
 *    POST /api/import/upload?preview=1   read it and say what is in it
 *    POST /api/import/upload             read it and queue the transfer
 *
 *  The body is either `multipart/form-data` with a `file` part, or JSON with
 *  `{ text }` for the paste box. Nothing is stored: the upload is parsed and
 *  thrown away, and only the resulting `import_items` outlive the request.
 *
 *  `destination` decides where the accepted songs land, `liked` by default
 *  (that is what this route is for); `playlist` makes an ordinary playlist
 *  import out of the same file. `skipLiked` (Skip already liked) leaves
 *  the songs the person has already liked out of a transfer into the likes;
 *  they count as already had. */

export const POST = withRequestLog('import/upload', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();

    // The declared length first, so a huge body is turned away before it is
    // buffered; what actually arrives is checked again by the parser.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && tooLarge(declared)) return jsonError(TOO_LARGE_MESSAGE, 413);

    const read = await readBody(request);
    if ('error' in read) return jsonError(read.error, read.status);

    const parsed = parseTransferInput(read.input);
    if (isParseError(parsed)) return jsonError(parsed.error, 422);

    const admin = await createAdminClient();
    const preview = new URL(request.url).searchParams.get('preview');
    if (preview === '1' || preview === 'true') {
      return Response.json({ preview: previewOf(parsed, await likedIndexFor(admin, user.id)) });
    }

    // Only a real transfer start counts against the hourly cap. The
    // The Transfer page fires a preview for every source it reads, which would
    // otherwise burn the 5-per-hour limit before the user ever presses
    // Import (see the branch above, which returns before this line).
    const limited = rateLimitResponse(`import-upload:${user.id}`, { windowMs: 3_600_000, max: 5 });
    if (limited) return limited;

    // A YourLibrary.json cannot be split by hand, so it starts with the
    // first 10 000 (the parser already cut it); anything else is refused.
    if (parsed.truncated && parsed.kind !== 'spotify-export') return jsonError(OVER_CAP_MESSAGE, 413);
    if (!parsed.items.length) return jsonError('There are no songs in that.', 422);

    const destination: JobKind = read.destination === 'playlist' ? 'playlist' : 'liked';
    let items = parsed.items;
    let existing = 0;
    if (destination === 'liked' && read.skipLiked) {
      const { fresh, liked } = splitAlreadyLiked(parsed.items, await likedIndexFor(admin, user.id));
      if (!fresh.length) return jsonError(ALL_LIKED_MESSAGE, 422);
      items = fresh;
      existing = liked.length;
    }
    const { job, playlistId } = await createImportJob(admin, {
      userId: user.id,
      source: jobSourceFor(parsed.kind),
      sourceId: parsed.kind,
      sourceUrl: '',
      name: destination === 'liked' ? parsed.label : parsed.label.replace(/^Liked songs from /, ''),
      coverUrl: null,
      kind: destination,
      order: parsed.order,
      items,
      ...(existing ? { existing } : {}),
    });
    kickImportRunner();
    return Response.json({ job, playlistId }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

interface BodyRead {
  input: { filename?: string; bytes?: Uint8Array; text?: string };
  destination?: string;
  skipLiked?: boolean;
}

/** A form field or JSON value that means yes. */
const yes = (v: unknown) => v === true || v === '1' || v === 'true';

/** The uploaded file or the pasted text, whichever this request carries. */
async function readBody(request: NextRequest): Promise<BodyRead | { error: string; status: number }> {
  const type = request.headers.get('content-type') ?? '';

  if (type.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: 'Ember could not read that upload. Try choosing the file again.', status: 400 };
    const file = form.get('file');
    const destination = form.get('destination');
    const skipLiked = yes(form.get('skipLiked'));
    if (typeof file === 'string' || !file) {
      const text = typeof form.get('text') === 'string' ? String(form.get('text')) : '';
      if (!text) return { error: 'Choose a file or paste your songs.', status: 400 };
      return { input: { text }, destination: typeof destination === 'string' ? destination : undefined, skipLiked };
    }
    if (tooLarge(file.size)) return { error: TOO_LARGE_MESSAGE, status: 413 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      // Only used to tell a .csv from a pasted list; the content decides the
      // rest.
      input: { filename: file.name.slice(0, 200), bytes },
      destination: typeof destination === 'string' ? destination : undefined,
      skipLiked,
    };
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown; destination?: unknown; skipLiked?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return { error: 'Choose a file or paste your songs.', status: 400 };
  return {
    input: { text },
    destination: typeof body?.destination === 'string' ? body.destination : undefined,
    skipLiked: yes(body?.skipLiked),
  };
}

export interface TransferPreview {
  kind: ParsedSource['kind'];
  label: string;
  order: ParsedSource['order'];
  count: number;
  dropped: number;
  truncated: boolean;
  /** The first few songs, so the person can see Ember read the right file. */
  sample: SongName[];
  // What the preview's chips count, each with the first few songs it means.
  // Optional: a Google likes preview (lib/import/google/flows.ts) has none.
  /** Songs the person has already liked (lib/import/alreadyLiked.ts). */
  alreadyLiked?: number;
  likedSample?: SongName[];
  /** The rest: songs not liked yet. */
  newSample?: SongName[];
  /** The same song a second time, brought over once. */
  duplicates?: number;
  duplicateSample?: SongName[];
  /** Rows with no song Ember could read. */
  unreadable?: number;
  /** Songs past the 10 000 one transfer carries, when known. */
  overLimit?: number;
}

export interface SongName {
  title: string;
  artist: string;
}

function previewOf(parsed: ParsedSource, liked: LikedIndex): TransferPreview {
  const name = (i: SongName): SongName => ({ title: i.title, artist: i.artist });
  const already = parsed.items.filter((i) => isAlreadyLiked(i, liked));
  const known = new Set(already);
  return {
    kind: parsed.kind,
    label: parsed.label,
    order: parsed.order,
    count: parsed.items.length,
    dropped: parsed.dropped,
    truncated: parsed.truncated,
    sample: parsed.items.slice(0, SAMPLE_SIZE).map(name),
    alreadyLiked: already.length,
    likedSample: already.slice(0, SAMPLE_SIZE).map(name),
    newSample: parsed.items.filter((i) => !known.has(i)).slice(0, SAMPLE_SIZE).map(name),
    duplicates: parsed.duplicates ?? 0,
    duplicateSample: parsed.duplicateSample ?? [],
    unreadable: parsed.unreadable ?? 0,
    overLimit: parsed.overLimit ?? 0,
  };
}
