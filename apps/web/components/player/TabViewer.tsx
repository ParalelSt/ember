'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  /** Where to fetch the Guitar Pro file from. */
  url: string;
  onBack: () => void;
}

interface ScoreTrack {
  index: number;
  name: string;
}

/** Renders a Guitar Pro file with AlphaTab.
 *
 *  AlphaTab is ~1MB of renderer plus a music font, so it is imported lazily —
 *  it must never land in the main bundle for the majority of members who
 *  never open a tab. Its own audio player stays OFF: Ember is already playing
 *  the song, and two audio engines would fight. Following the playhead comes
 *  next; for now this is a reader. */
export function TabViewer({ url, onBack }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const [tracks, setTracks] = useState<ScoreTrack[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let api: { destroy: () => void } | null = null;

    // AlphaTab reports failures through its `error` event, but a file that
    // passed the upload sniff and is still malformed can leave it sitting
    // there with neither event — so cap the wait rather than showing
    // "Rendering the tab…" forever.
    let settled = false;
    const timer = setTimeout(() => {
      if (!cancelled && !settled) {
        setError('That file could not be rendered.');
        setLoading(false);
      }
    }, 20_000);

    (async () => {
      try {
        const [{ AlphaTabApi }, res] = await Promise.all([
          import('@coderline/alphatab'),
          fetch(url, { credentials: 'same-origin' }),
        ]);
        if (!res.ok) throw new Error(`Could not load that tab (${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (cancelled || !hostRef.current) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created: any = new AlphaTabApi(hostRef.current, {
          core: { engine: 'svg', fontDirectory: '/alphatab/font/' },
          display: { scale: 0.8 },
          player: { enablePlayer: false },
        });
        api = created;
        apiRef.current = created;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        created.scoreLoaded.on((score: any) => {
          if (cancelled) return;
          setTracks(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (score.tracks ?? []).map((t: any, i: number) => ({
              index: i,
              name: String(t.name || `Track ${i + 1}`),
            })),
          );
          setActive(0);
          // The score is parsed; drawing follows within a frame or two. Not
          // waiting for renderFinished here because which render event fires
          // (and whether it fires at all) varies by AlphaTab version.
          settled = true;
          setLoading(false);
        });
        created.renderFinished.on(() => {
          settled = true;
          if (!cancelled) setLoading(false);
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        created.error.on((e: any) => {
          settled = true;
          if (!cancelled) {
            setError(String(e?.message || 'AlphaTab could not read that file.'));
            setLoading(false);
          }
        });

        created.load(bytes);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not open that tab.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        api?.destroy();
      } catch {
        // A half-initialised AlphaTab can throw on destroy; the dialog is
        // closing either way.
      }
      apiRef.current = null;
    };
  }, [url]);

  const showTrack = (index: number) => {
    setActive(index);
    const api = apiRef.current;
    const track = api?.score?.tracks?.[index];
    if (track) api.renderTracks([track]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        {tracks.map((t) => (
          <Button
            key={t.index}
            size="sm"
            variant={t.index === active ? 'default' : 'outline'}
            onClick={() => showTrack(t.index)}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{error}</div>
      ) : (
        <>
          {loading && (
            <div className="py-6 text-center text-sm text-muted-foreground">Rendering the tab…</div>
          )}
          <div className="max-h-[60vh] overflow-auto rounded-md bg-white p-2">
            <div ref={hostRef} />
          </div>
        </>
      )}
    </div>
  );
}
