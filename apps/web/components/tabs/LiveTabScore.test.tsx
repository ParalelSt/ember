import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { LiveTabScore, type LiveTabScoreProps } from './LiveTabScore';

// AlphaTab needs a real browser, so this is a fake of the few members the
// tab page uses: the settings it is built with, its events (fired by the
// test), the external media output the playhead is fed to, the tick lookup
// a click is resolved through, and the bounds follow-scroll reads.
const at = vi.hoisted(() => ({ apis: [] as FakeApi[] }));

type Handler = (arg?: unknown) => void;
class Emitter {
  fns: Handler[] = [];
  on(fn: Handler) {
    this.fns.push(fn);
  }
  fire(arg?: unknown) {
    this.fns.forEach((f) => f(arg));
  }
}
interface FakeApi {
  settings: {
    display: Record<string, unknown>;
    notation: Record<string, unknown>;
    player: Record<string, unknown>;
    core: Record<string, unknown>;
  };
  scoreLoaded: Emitter;
  postRenderFinished: Emitter;
  error: Emitter;
  playerReady: Emitter;
  playerPositionChanged: Emitter;
  beatMouseDown: Emitter;
  playedBeatChanged: Emitter;
  player: { output: { handler: Record<string, unknown> | null; updatePosition: ReturnType<typeof vi.fn> } };
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  renderTracks: ReturnType<typeof vi.fn>;
  playerState: number;
  score: { tracks: object[] } | null;
  tracks: object[];
  tickCache: unknown;
  renderer: unknown;
  loaded: { tracks: number[] } | null;
}

vi.mock('@coderline/alphatab', () => {
  const bar2 = { id: 'mb2' };
  class AlphaTabApi {
    settings: FakeApi['settings'];
    scoreLoaded = new Emitter();
    postRenderFinished = new Emitter();
    error = new Emitter();
    playerReady = new Emitter();
    playerPositionChanged = new Emitter();
    beatMouseDown = new Emitter();
    playedBeatChanged = new Emitter();
    player = { output: { handler: null, updatePosition: vi.fn() } };
    play = vi.fn();
    pause = vi.fn();
    updateSettings = vi.fn();
    render = vi.fn();
    renderTracks = vi.fn();
    playerState = 0;
    score: FakeApi['score'] = null;
    tracks: object[] = [];
    loaded: FakeApi['loaded'] = null;
    tickCache = {
      masterBars: [{ tempoChanges: [{ tick: 0, tempo: 96 }] }],
      getMasterBarStart: (mb: unknown) => (mb === bar2 ? 3840 : 0),
      getRelativeBeatPlaybackRange: () => ({ startTick: 1920 }),
    };
    renderer = {
      boundsLookup: {
        findBeat: () => ({ barBounds: { masterBarBounds: { visualBounds: { x: 2000, y: 1500, w: 300, h: 120 } } } }),
      },
    };
    constructor(_host: HTMLElement, settings: FakeApi['settings']) {
      this.settings = {
        core: settings.core,
        display: { ...settings.display },
        notation: { ...settings.notation },
        player: settings.player,
      };
      at.apis.push(this as unknown as FakeApi);
    }
    load(_bytes: Uint8Array, tracks: number[]) {
      this.loaded = { tracks };
      const score = {
        tempo: 96,
        masterBars: [{ keySignature: -1, keySignatureType: 1 }],
        tracks: [
          { name: 'Guitar', playbackInfo: { program: 30 }, staves: [{ tuning: [64, 59, 55, 50, 45, 38], tuningName: 'Guitar Dropped D Tuning' }] },
          { name: 'Bass', playbackInfo: { program: 33 }, staves: [{ tuning: [43, 38, 33, 26] }] },
        ],
      };
      this.score = score;
      this.tracks = [score.tracks[tracks[0] ?? 0]];
      this.scoreLoaded.fire(score);
      this.postRenderFinished.fire();
    }
    destroy() {}
  }
  return {
    AlphaTabApi,
    PlayerMode: { EnabledExternalMedia: 3 },
    ScrollMode: { Off: 0, Continuous: 1 },
    StaveProfile: { Tab: 'tab', ScoreTab: 'score-tab' },
    LayoutMode: { Page: 'page', Horizontal: 'horizontal' },
    TabRhythmMode: { ShowWithBars: 'bars' },
    NotationElement: new Proxy({}, { get: (_t, k) => String(k) }),
    _bar2: bar2,
  };
});

const bar2Beat = async () => {
  const mod = (await import('@coderline/alphatab')) as unknown as { _bar2: object };
  return { playbackStart: 0, voice: { bar: { masterBar: mod._bar2 } } };
};

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  // AlphaTab waits for its host to have a width before drawing.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
});
afterAll(() => {
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
});

beforeEach(() => {
  at.apis.length = 0;
});

function props(over: Partial<LiveTabScoreProps> = {}): LiveTabScoreProps {
  return {
    url: '/api/tabs/files/t1/download',
    staff: 'tab',
    scroll: 'vertical',
    track: 0,
    scale: 0.95,
    offsetMs: 0,
    follows: true,
    playing: false,
    position: 0,
    duration: 180,
    onSeek: vi.fn(),
    ...over,
  };
}

async function mount(over: Partial<LiveTabScoreProps> = {}) {
  const p = props(over);
  const view = render(<LiveTabScore {...p} />);
  await waitFor(() => expect(view.getByTestId('tab-score').dataset.status).toBe('ready'));
  const api = at.apis[0];
  api.playerReady.fire();
  return { view, api, p };
}

describe('LiveTabScore settings', () => {
  it('draws in external media mode: AlphaTab never plays, seeks or scrolls on its own', async () => {
    const { api } = await mount();
    expect(api.settings.player).toMatchObject({
      enablePlayer: true,
      playerMode: 3,
      enableCursor: true,
      enableUserInteraction: false,
      scrollMode: 0,
    });
    expect(api.settings.core).toMatchObject({ useWorkers: false, engine: 'svg' });
  });

  it('Tab, vertical page layout, at the given scale, with Ember colours', async () => {
    const { api } = await mount();
    expect(api.settings.display).toMatchObject({ staveProfile: 'tab', layoutMode: 'page', scale: 0.95 });
    expect(api.settings.display.resources).toMatchObject({ mainGlyphColor: expect.stringMatching(/^rgba\(/) });
    expect(api.settings.notation.rhythmMode).toBe('bars');
  });

  it('switching to Horizontal and Tab + Score re-lays out the same score', async () => {
    const { view, api, p } = await mount();
    const resources = api.settings.display.resources;
    view.rerender(<LiveTabScore {...p} scroll="horizontal" staff="score-tab" />);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    // AlphaTab's own RenderingResources instance stays: replacing it with a
    // plain object made the real re-render throw.
    expect(api.settings.display.resources).toBe(resources);
    expect(api.settings.display).toMatchObject({ layoutMode: 'horizontal', staveProfile: 'score-tab' });
    expect(at.apis).toHaveLength(1);
    expect(view.getByTestId('tab-score').dataset.scroll).toBe('horizontal');
  });

  it('loads the chosen track, and switches instrument without reloading', async () => {
    const { view, api, p } = await mount({ track: 1 });
    expect(api.loaded?.tracks).toEqual([1]);
    expect(api.renderTracks).not.toHaveBeenCalled();
    view.rerender(<LiveTabScore {...p} track={0} />);
    expect(api.renderTracks).toHaveBeenCalledWith([api.score!.tracks[0]]);
  });

  it('reports the score for the header', async () => {
    const onScore = vi.fn();
    await mount({ onScore });
    expect(onScore).toHaveBeenCalledWith(expect.objectContaining({ tempo: 96, key: 'D minor' }));
  });
});

describe('LiveTabScore sync', () => {
  it('feeds Ember’s playhead to the cursor, shifted by the offset', async () => {
    const { api } = await mount({ position: 10, offsetMs: 1500 });
    await waitFor(() => expect(api.player.output.updatePosition).toHaveBeenCalledWith(11_500));
  });

  it('mirrors play and pause, so the cursor runs and stops with the song', async () => {
    const { view, api, p } = await mount();
    view.rerender(<LiveTabScore {...p} playing />);
    await waitFor(() => expect(api.play).toHaveBeenCalled());
    view.rerender(<LiveTabScore {...p} playing={false} />);
    await waitFor(() => expect(api.pause).toHaveBeenCalled());
  });

  it('a seek from the player bar moves the cursor while paused', async () => {
    const { view, api, p } = await mount({ position: 5 });
    view.rerender(<LiveTabScore {...p} position={60} />);
    await waitFor(() => expect(api.player.output.updatePosition).toHaveBeenLastCalledWith(60_000));
  });

  it('clicking a beat seeks the song to where it sounds, once', async () => {
    const onSeek = vi.fn();
    const { api } = await mount({ onSeek, offsetMs: 1000 });
    api.beatMouseDown.fire(await bar2Beat());
    // Bar 2 plus half a bar at 96 bpm is 3.75 s of tab; the tab runs 1 s ahead.
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(2.75);
  });

  it('AlphaTab’s own transport calls never reach the player', async () => {
    const onSeek = vi.fn();
    const { api } = await mount({ onSeek });
    const handler = api.player.output.handler as { seekTo: (ms: number) => void; play: () => void; pause: () => void };
    handler.seekTo(0);
    handler.play();
    handler.pause();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('a song that is not playing: no feed, no seek, no cursor', async () => {
    const onSeek = vi.fn();
    const { view, api } = await mount({ follows: false, onSeek, position: 30 });
    api.beatMouseDown.fire(await bar2Beat());
    await new Promise((r) => setTimeout(r, 120));
    expect(onSeek).not.toHaveBeenCalled();
    expect(api.player.output.updatePosition).not.toHaveBeenCalled();
    expect(view.getByTestId('tab-score').className).toContain('[&_.at-cursor-beat]:hidden');
  });
});

describe('LiveTabScore follow-scroll', () => {
  it('after a re-layout (Horizontal, a resize) it finds the playing beat again', async () => {
    const page = document.createElement('div');
    page.scrollTo = vi.fn() as never;
    const { api } = await mount({ getPageScroller: () => page });
    api.playedBeatChanged.fire({});
    const before = (page.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    api.postRenderFinished.fire();
    expect((page.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it('vertical: scrolls the page scroller down to the playing bar', async () => {
    const page = document.createElement('div');
    page.scrollTo = vi.fn() as never;
    const { api } = await mount({ getPageScroller: () => page, getTopInset: () => 60 });
    api.playedBeatChanged.fire({});
    expect(page.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number), behavior: 'smooth' }));
    expect((page.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].left).toBeUndefined();
  });

  it('horizontal: scrolls its own row sideways, never the page', async () => {
    const page = document.createElement('div');
    page.scrollTo = vi.fn() as never;
    const { view, api } = await mount({ scroll: 'horizontal', getPageScroller: () => page });
    const row = view.getByTestId('tab-score');
    row.scrollTo = vi.fn() as never;
    api.playedBeatChanged.fire({});
    expect(row.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number) }));
    expect(page.scrollTo).not.toHaveBeenCalled();
  });
});
