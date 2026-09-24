import 'server-only';
import type PocketBase from 'pocketbase';
import { parseThemeDoc, type ThemeDoc } from '@/lib/theme/model';
import { problems } from '@/lib/theme/guard';
import type { ThemeInputs } from '@/lib/theme/model';

/** The active theme on the signed-in user's own row (users.theme), read and
 *  written with their own client: the users rules already limit that row
 *  to its owner. */
export async function readActive(pb: PocketBase, userId: string): Promise<ThemeDoc> {
  const record = await pb.collection('users').getOne(userId);
  return parseThemeDoc(record.theme);
}

export async function writeActive(pb: PocketBase, userId: string, doc: ThemeDoc): Promise<ThemeDoc> {
  const record = await pb.collection('users').update(userId, { theme: doc });
  return parseThemeDoc(record.theme);
}

/** 422 for colours with a failing readability pair. Never adjusted on the
 *  server: the person sees the findings and chooses a fix. */
export function unreadableResponse(inputs: ThemeInputs): Response | null {
  const fails = problems(inputs).filter((f) => f.level === 'fail');
  if (fails.length === 0) return null;
  return Response.json(
    {
      error: 'Fix the readability problems to save',
      findings: fails.map(({ pair, label, ratio }) => ({ pair, label, ratio })),
    },
    { status: 422 },
  );
}
