'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/components/player/PlayerProvider';

interface Props {
  /** Where to fetch the Guitar Pro / MusicXML file from. */
  url: string;
  /** Identifies the tab, so its timing offset is remembered per file. */
  tabId: string;
  onBack: () => void;
}

interface ScoreTrack {
  index: number;
  name: string;
}

/** How far a tab may be nudged against the recording, in seconds. Intros,
 *  count-ins and silence at the top of a file differ from the release, and no
 *  amount of cleverness can guess by how much. */
const MAX_OFFSET = 10;

const offsetKey = (tabId: string) => `ember.tab.offset.${tabId}`;

function loadOffset(tabId: string): number {
  try {
    const raw = window.localStorage.getItem(offsetKey(tabId));
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, n)) : 0;
  } catch {
    // Private windows and blocked site data both throw here.
    return 0;
  }
}

/** Renders a tab with AlphaTab and walks its cursor in time with the song.
 *
 *  AlphaTab ships its own synthesizer, and we do not use it: Ember is already
 *  playing the real recording, and two audio engines would fight. Instead the
 *  score is loaded in `EnabledExternalMedia` mode, which exists precisely for
 *  this — alphaTab draws and moves the cursor while something else owns the
 *  time axis. We feed it Ember's playhead and it does the rest.
 *
 *  Accuracy is bar-level, not sample-level. A tab is a transcription of a
 *  performance, not a render of this particular recording: tempo drift, a
 *  different take, or a count-in will all pull it out of step. The offset
 *  control is the honest answer to that, and it is remembered per file. */
export function TabViewer({ url, tabId, onBack }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputRef = useRef<any>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const [tracks, setTracks] = useState<ScoreTrack[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [synced, setSynced] = useState(false);
  const [offset, setOffset] = useState(0);

  const { position, duration, isPlaying, seek } = usePlayer();

  // The handler alphaTab calls is installed once, but it must always act on
  // the CURRENT player controls, so route through refs.
  const seekRef = useRef(seek);
  const playingRef = useRef(isPlaying);
  const durationRef = useRef(duration);
  const offsetRef = useRef(offset);
  /** The last playhead value handed to alphaTab, so an echoed seek can be
   *  told apart from the user clicking a bar in the score. */
  const lastFedRef = useRef(0);
  seekRef.current = seek;
  playingRef.current = isPlaying;
  durationRef.current = duration;
  offsetRef.current = offset;

  useEffect(() => {
    setOffset(loadOffset(tabId));
  }, [tabId]);

  const changeOffset = useCallback(
    (next: number) => {
      const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(next * 10) / 10));
      setOffset(clamped);
      try {
        window.localStorage.setItem(offsetKey(tabId), String(clamped));
      } catch {
        // Not being able to remember the nudge is not worth an error.
      }
    },
    [tabId],
  );

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
        const [alphaTab, res] = await Promise.all([
          import('@coderline/alphatab'),
          fetch(url, { credentials: 'same-origin' }),
        ]);
        if (!res.ok) throw new Error(`Could not load that tab (${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (cancelled || !hostRef.current) return;

        // AlphaTab measures its container ONCE, at construction, and lays the
        // score out to that width. This viewer lives in a dialog, which is
        // still being laid out when the effect runs, so it measured zero and
        // rendered a 0x0 score: the notation was invisible and the playback
        // cursor collapsed to a 1% scale with nowhere to travel. Wait for a
        // real width first.
        const host = hostRef.current;
        const gotWidth = await new Promise<boolean>((resolve) => {
          const deadline = Date.now() + 4000;
          const tick = () => {
            if (cancelled) return resolve(false);
            if (host.clientWidth > 0) return resolve(true);
            if (Date.now() > deadline) return resolve(false);
            requestAnimationFrame(tick);
          };
          tick();
        });
        if (cancelled) return;
        if (!gotWidth) throw new Error('The tab viewer never got a size to draw into.');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created: any = new (alphaTab as any).AlphaTabApi(hostRef.current, {
          core: {
            engine: 'svg',
            fontDirectory: '/alphatab/font/',
            // Render on the main thread. AlphaTab normally lays the score out
            // in a Web Worker whose script URL it derives from its own
            // <script> tag — which does not exist when it is imported through
            // a bundler, so the worker never starts and the surface renders
            // 848x0: scaffolding, no music, no error. Scores here are a few
            // hundred bars, so the main thread copes fine.
            useWorkers: false,
          },
          display: { scale: 0.8 },
          player: {
            enablePlayer: true,
            // Ember owns the time axis; alphaTab only draws the cursor.
            playerMode: (alphaTab as { PlayerMode: { EnabledExternalMedia: number } }).PlayerMode
              .EnabledExternalMedia,
            enableCursor: true,
            enableAnimatedBeatCursor: true,
            scrollElement: scrollRef.current ?? undefined,
          },
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

        // Bridge alphaTab's transport to Ember's. Without a handler alphaTab
        // has no media to talk to and refuses to move its cursor.
        const installHandler = () => {
          const output = created.player?.output;
          if (!output || cancelled) return;
          outputRef.current = output;
          const installedAt = Date.now();
          output.handler = {
            get backingTrackDuration() {
              return Math.max(0, durationRef.current) * 1000;
            },
            playbackRate: 1,
            masterVolume: 1,
            // Ember owns the transport, so these are deliberately inert.
            // alphaTab calls play/pause as part of its OWN lifecycle (it
            // pauses while wiring itself up, and again whenever its cursor
            // reaches the end of the score). Forwarding those to the player
            // meant opening a tab silently paused the user's music.
            play: () => {},
            pause: () => {},
            seekTo: (ms: number) => {
              // Clicking a bar in the score should move the song. But alphaTab
              // also seeks while initialising, and echoes back positions we
              // fed it, and either one would yank the listener somewhere they
              // did not ask to go. So honour a seek only once it has settled,
              // and only when it is a real jump rather than an echo.
              if (Date.now() - installedAt < 2000) return;
              const target = ms / 1000 - offsetRef.current;
              if (Math.abs(target - lastFedRef.current) < 1) return;
              seekRef.current(Math.max(0, target));
            },
          };
          setSynced(true);
          // Start the cursor here, not from the transport effect. This runs on
          // alphaTab's `playerReady`, which is the first moment `play()` is
          // actually honoured; issuing it earlier is silently dropped, and
          // since `synced` only ever flips once, nothing would retry it.
          if (playingRef.current) {
            try {
              created.play();
            } catch {
              // A cursor that will not start must never break playback.
            }
          }
        };
        created.playerReady.on(installHandler);
        installHandler(); // in case the player was ready before we subscribed

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        created.error.on((e: any) => {
          settled = true;
          if (!cancelled) {
            setError(String(e?.message || 'AlphaTab could not read that file.'));
            setLoading(false);
          }
        });

        created.load(bytes);

        // And keep it right afterwards: the dialog can still grow, and the
        // window can be resized while a tab is open.
        let lastWidth = host.clientWidth;
        const observer = new ResizeObserver(() => {
          const w = host.clientWidth;
          if (w > 0 && Math.abs(w - lastWidth) > 8) {
            lastWidth = w;
            try {
              created.render();
            } catch {
              // A re-render that fails leaves the previous one on screen.
            }
          }
        });
        observer.observe(host);
        observerRef.current = observer;
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
      observerRef.current?.disconnect();
      observerRef.current = null;
      apiRef.current = null;
      outputRef.current = null;
    };
  }, [url]);

  // Mirror Ember's transport into alphaTab. Its cursor only animates while it
  // believes playback is running, so a score left in the stopped state sits
  // at bar 1 no matter how many positions we feed it. Our own handler is
  // guarded against re-entry, so this cannot ping-pong with Ember.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !synced) return;
    try {
      if (isPlaying) api.play();
      else api.pause();
    } catch {
      // Transport mirroring is a nicety; never let it break playback.
    }
  }, [isPlaying, synced]);

  // Walk the cursor. This runs on every playhead tick, which is the whole
  // point: alphaTab has no idea what time it is unless we tell it.
  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    lastFedRef.current = position;
    try {
      output.updatePosition(Math.max(0, (position + offset) * 1000));
    } catch {
      // A cursor that cannot be moved must never break playback.
    }
  }, [position, offset, synced]);

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
          <div ref={scrollRef} className="max-h-[60vh] overflow-auto rounded-md bg-white p-2">
            <div ref={hostRef} />
          </div>

          {/* Nudge. A tab is a transcription, not a render of this recording,
              so some files simply start a beat or two off. */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">Sync</span>
            <input
              type="range"
              min={-MAX_OFFSET}
              max={MAX_OFFSET}
              step={0.1}
              value={offset}
              onChange={(e) => changeOffset(Number(e.target.value))}
              className="flex-1 accent-ember"
              aria-label="Tab timing offset in seconds"
            />
            <span className="w-16 shrink-0 tabular-nums text-right">
              {offset > 0 ? '+' : ''}
              {offset.toFixed(1)}s
            </span>
            <Button size="sm" variant="ghost" onClick={() => changeOffset(0)}>
              Reset
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
