'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { EmptyState } from '@/components/page/EmptyState';

/** An invite link: /playlist/join/<code>. Signed out, proxy.ts sends the
 *  browser to sign in first and back here after. Signed in, it asks the
 *  server to add you (a POST, so a link preview never joins anyone) and
 *  opens the playlist. */
export default function JoinPlaylistPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  // Once per code, even when React runs effects twice in development.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (asked.current === code) return;
    asked.current = code;
    api
      .joinPlaylist(code)
      .then(async ({ playlistId, joined }) => {
        if (joined) toast.success('You can edit this playlist now');
        await qc.invalidateQueries({ queryKey: QK.playlists });
        router.replace(`/playlist/${playlistId}`);
      })
      .catch((e: Error) => setProblem(e.message));
  }, [code, qc, router]);

  if (problem) {
    return (
      <EmptyState>
        <span data-testid="join-problem">{problem}</span>
        <br />
        <Link href="/library" className="text-ember hover:underline">Back to library</Link>
      </EmptyState>
    );
  }
  return <EmptyState>Opening the playlist…</EmptyState>;
}
