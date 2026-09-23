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
  tooLarge,
  TOO_LARGE_MESSAGE,
  type ParsedSource,
} from '@/lib/import/sources/index';
import { jobSourceFor } from '@/lib/import/sources/types';
import { OVER_CAP_MESSAGE } from '@/lib/import/transferCopy';
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
 *  import out of the same file. */

/** How many songs the preview shows. */
const SAMPLE_SIZE = 5;

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

    const preview = new URL(request.url).searchParams.get('preview');
    if (preview === '1' || preview === 'true') return Response.json({ preview: previewOf(parsed) });

    // Only a real transfer start counts against the hourly cap. The
    // TransferDialog fires a preview on every pause in typing, which would
    // otherwise burn the 5-per-hour limit before the user ever presses
    // Import (see the branch above, which returns before this line).
    const limited = rateLimitResponse(`import-upload:${user.id}`, { windowMs: 3_600_000, max: 5 });
    if (limited) return limited;

    if (parsed.truncated) return jsonError(OVER_CAP_MESSAGE, 413);
    if (!parsed.items.length) return jsonError('There are no songs in that.', 422);

    const destination: JobKind = read.destination === 'playlist' ? 'playlist' : 'liked';
    const admin = await createAdminClient();
    const { job, playlistId } = await createImportJob(admin, {
      userId: user.id,
      source: jobSourceFor(parsed.kind),
      sourceId: parsed.kind,
      sourceUrl: '',
      name: destination === 'liked' ? parsed.label : parsed.label.replace(/^Liked songs from /, ''),
      coverUrl: null,
      kind: destination,
      order: parsed.order,
      items: parsed.items,
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
}

/** The uploaded file or the pasted text, whichever this request carries. */
async function readBody(request: NextRequest): Promise<BodyRead | { error: string; status: number }> {
  const type = request.headers.get('content-type') ?? '';

  if (type.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: 'Ember could not read that upload. Try choosing the file again.', status: 400 };
    const file = form.get('file');
    const destination = form.get('destination');
    if (typeof file === 'string' || !file) {
      const text = typeof form.get('text') === 'string' ? String(form.get('text')) : '';
      if (!text) return { error: 'Choose a file or paste your songs.', status: 400 };
      return { input: { text }, destination: typeof destination === 'string' ? destination : undefined };
    }
    if (tooLarge(file.size)) return { error: TOO_LARGE_MESSAGE, status: 413 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      // Only used to tell a .csv from a pasted list; the content decides the
      // rest.
      input: { filename: file.name.slice(0, 200), bytes },
      destination: typeof destination === 'string' ? destination : undefined,
    };
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown; destination?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) return { error: 'Choose a file or paste your songs.', status: 400 };
  return { input: { text }, destination: typeof body?.destination === 'string' ? body.destination : undefined };
}

export interface TransferPreview {
  kind: ParsedSource['kind'];
  label: string;
  order: ParsedSource['order'];
  count: number;
  dropped: number;
  truncated: boolean;
  /** The first few songs, so the person can see Ember read the right file. */
  sample: { title: string; artist: string }[];
}

function previewOf(parsed: ParsedSource): TransferPreview {
  return {
    kind: parsed.kind,
    label: parsed.label,
    order: parsed.order,
    count: parsed.items.length,
    dropped: parsed.dropped,
    truncated: parsed.truncated,
    sample: parsed.items.slice(0, SAMPLE_SIZE).map((i) => ({ title: i.title, artist: i.artist })),
  };
}
