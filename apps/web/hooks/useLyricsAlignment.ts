'use client';

import { useEffect, useState } from 'react';
import { hashLrc } from '@/lib/lyricsHash';
import { readOffset, writeOffset } from '@/lib/lyricsOffsetCache';
import {
  computeOffset as computeOffsetCore,
  findFirstNonSilenceSec,
} from '@/lib/lyricsAligner';
import { apiUrl } from '@/lib/api';
import type { LyricsLine } from '@/hooks/useLyrics';
import type { Track } from '@/types/track';

/** How many bytes of the audio to fetch for the silence-boundary scan.
 *  200KB ≈ 12s at typical YouTube bitrates — plenty of headroom to
 *  span any plausible intro silence without ballooning memory. */
const ANALYSIS_BYTES = 200_000;

/** Returns the LRC offset (seconds) for the current track. 0 means
 *  "no shift" — applied additively in the SyncedLyrics binary search.
 *  Returns 0 while alignment is in flight, then updates to the cached
 *  or freshly-computed value when ready. */
export function useLyricsAlignment(
  track: Track | null,
  lines: LyricsLine[] | null,
): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
    if (!track || !lines || lines.length === 0) return;

    const lrcHash = hashLrc(lines);

    // Cache hit short-circuit.
    const cached = readOffset(track.id, lrcHash);
    if (cached !== null) {
      setOffset(cached);
      return;
    }

    // Cache miss → background analysis.
    const ac = new AbortController();
    (async () => {
      try {
        const url = apiUrl(track.streamUrl);
        const res = await fetch(url, {
          headers: { Range: `bytes=0-${ANALYSIS_BYTES}` },
          signal: ac.signal,
          credentials: 'include',
        });
        if (!res.ok && res.status !== 206) return;
        const buf = await res.arrayBuffer();
        if (ac.signal.aborted) return;

        // One-off AudioContext purely for decode. Close it after.
        const AudioCtor: typeof AudioContext | undefined =
          window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtor) return;
        const ctx = new AudioCtor();
        let audioBuf: AudioBuffer;
        try {
          audioBuf = await ctx.decodeAudioData(buf);
        } catch {
          await ctx.close().catch(() => {});
          return;
        }
        await ctx.close().catch(() => {});

        if (ac.signal.aborted) return;
        const channel = audioBuf.getChannelData(0);
        const tAudio = findFirstNonSilenceSec(channel, audioBuf.sampleRate);
        const tLrcFirst = lines[0]?.time ?? 0;
        const computed = computeOffsetCore(tAudio, tLrcFirst);

        if (ac.signal.aborted) return;
        writeOffset(track.id, lrcHash, computed);
        setOffset(computed);
      } catch {
        // Network/decode/abort errors all fall through to offset=0.
      }
    })();

    return () => {
      ac.abort();
    };
    // Track id + line identity drive the alignment; the rest of `track`
    // doesn't affect what we compute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, lines]);

  return offset;
}
