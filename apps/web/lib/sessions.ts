import 'server-only';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { ForbiddenError } from '@/lib/auth';

/** Unambiguous join-code alphabet (no 0/O/1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newSessionCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

interface StatusError extends Error {
  status?: number;
}

export async function loadSession(pb: PocketBase, id: string): Promise<RecordModel> {
  try {
    return await pb.collection('sessions').getOne(id, { expand: 'host' });
  } catch {
    const e: StatusError = new Error('Session not found.');
    e.status = 404;
    throw e;
  }
}

export function assertActive(session: RecordModel): void {
  if (session.active !== true) {
    const e: StatusError = new Error('This session has ended.');
    e.status = 410;
    throw e;
  }
}

export function assertHost(session: RecordModel, userId: string): void {
  if (session.host !== userId) throw new ForbiddenError();
}
