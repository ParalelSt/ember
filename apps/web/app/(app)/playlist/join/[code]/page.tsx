'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { InvitePreview } from '@/lib/collab';
import { QK } from '@/hooks/useLibrary';
import { EmptyState } from '@/components/page/EmptyState';
import { InvitePreviewCard } from '@/components/library/InvitePreviewCard';

/** An invite link: /playlist/join/<code>. Signed out, proxy.ts sends the
 *  browser to sign in first and back here after. Signed in, it shows what
 *  the link leads to (a read that adds nobody), and only Join asks the
 *  server to add you (a POST, so a link preview never joins anyone). Not
 *  now leaves the link working. Someone already on it goes straight in. */
export default function JoinPlaylistPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // Once per code, even when React runs effects twice in development.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (asked.current === code) return;
    asked.current = code;
    api
      .previewPlaylistInvite(code)
      .then((card) => {
        if (card.alreadyIn && card.playlistId) router.replace(`/playlist/${card.playlistId}`);
        else setPreview(card);
      })
      .catch((e: Error) => setProblem(e.message));
  }, [code, router]);

  const join = async () => {
    setJoining(true);
    try {
      const { playlistId, joined } = await api.joinPlaylist(code);
      if (joined) toast.success('You can edit this playlist now');
      await qc.invalidateQueries({ queryKey: QK.playlists });
      router.replace(`/playlist/${playlistId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setJoining(false);
    }
  };

  const decline = () => {
    toast.message('Not joined. The link still works if you change your mind.');
    router.replace('/library');
  };

  if (problem) {
    return (
      <EmptyState>
        <span data-testid="join-problem">{problem}</span>
        <br />
        <Link href="/library" className="text-ember hover:underline">Back to library</Link>
      </EmptyState>
    );
  }
  if (!preview) return <EmptyState>Opening the invite…</EmptyState>;
  return <InvitePreviewCard preview={preview} busy={joining} onJoin={() => void join()} onDecline={decline} />;
}
