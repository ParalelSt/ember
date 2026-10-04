'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { liveCarlistKey } from '@/hooks/useSession';
import { normalizeCode } from '@/lib/carlist';
import { EmptyState } from '@/components/page/EmptyState';

/** A carlist join link (/session/join/<code>, the host's QR code and "Copy
 *  link"). Signed out, proxy.ts sends the browser to sign in first and back
 *  here after. Signed in, it asks the server to add you (a POST, so a link
 *  preview never joins anyone) and opens the live carlist. */
export default function JoinCarlistPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const code = normalizeCode(safeDecode(raw));
  const [problem, setProblem] = useState<string | null>(code ? null : 'That link has no carlist code in it.');
  // Once per code, even when React runs effects twice in development.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!code || asked.current === code) return;
    asked.current = code;
    api
      .joinSession(code)
      .then(async ({ session }) => {
        toast.success(`You're in "${session.name}". Add a song!`);
        await qc.invalidateQueries({ queryKey: liveCarlistKey });
        router.replace(`/session/${session.id}`);
      })
      .catch((e: Error) => setProblem(e.message || "Couldn't join that carlist."));
  }, [code, qc, router]);

  if (problem) {
    return (
      <EmptyState>
        <span data-testid="join-problem">{problem}</span>
        <br />
        <span className="text-muted-foreground">It may have ended. You can also type the host&apos;s code under Carlist in Your library.</span>
        <br />
        <Link href="/library" className="text-ember hover:underline">
          Back to library
        </Link>
      </EmptyState>
    );
  }
  return <EmptyState>Joining the carlist…</EmptyState>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
