import { attachmentProblem, formAttachments, PAYLOAD_FIELD } from '@/lib/attachments';

export type ReportBody<T> =
  | { ok: true; body: T; files: File[] }
  /** `error` is attachmentProblem()'s sentence when the files are the
   *  problem, null when the body itself is unreadable (the route words that). */
  | { ok: false; error: string | null };

/** The body of a bug report or a request. A JSON body (lib/autoReport.ts,
 *  and either dialog with nothing attached) comes through as it always
 *  did; a multipart one carries that same JSON in its `payload` part and the
 *  screenshots and clips as `attachments`, re-checked here with the rules
 *  the dialog used. */
export async function readReportBody<T>(request: Request): Promise<ReportBody<T>> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    const body = (await request.json().catch(() => null)) as T | null;
    return body ? { ok: true, body, files: [] } : { ok: false, error: null };
  }
  const form = await request.formData().catch(() => null);
  const raw = form?.get(PAYLOAD_FIELD);
  if (!form || typeof raw !== 'string') return { ok: false, error: null };
  let body: T | null = null;
  try {
    body = JSON.parse(raw) as T | null;
  } catch {
    return { ok: false, error: null };
  }
  if (!body) return { ok: false, error: null };
  const files = formAttachments(form);
  const problem = attachmentProblem(files);
  if (problem) return { ok: false, error: problem };
  return { ok: true, body, files };
}
