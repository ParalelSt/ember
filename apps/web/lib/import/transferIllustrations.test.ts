import { describe, expect, it } from 'vitest';
import { STEP_FRAMES, stepFrame } from './transferIllustrations';
import { TRANSFER_SERVICES } from './transferRoutes';

const routes = TRANSFER_SERVICES.flatMap((s) => s.routes);

describe('the pictures beside the steps', () => {
  it('every way in has one picture per step, and no picture for a route that is gone', () => {
    for (const r of routes) expect(STEP_FRAMES[r.id]?.length, r.id).toBe(r.steps.length);
    expect(Object.keys(STEP_FRAMES).sort()).toEqual(routes.map((r) => r.id).sort());
  });

  it('every tapped row is a row that is there', () => {
    for (const [id, frames] of Object.entries(STEP_FRAMES)) {
      for (const f of frames) expect(f.tap === -1 || (f.tap >= 0 && f.tap < f.rows.length), `${id}: ${f.title}`).toBe(true);
    }
  });

  it('a file, a list or a link ends on Ember, where it goes in', () => {
    for (const r of routes) {
      if (r.kind === 'google') continue;
      const last = STEP_FRAMES[r.id][r.steps.length - 1];
      expect(last.app, r.id).toBe('Ember');
    }
  });

  it('the Spotify export walks Account, Privacy settings, the zip, then Ember', () => {
    expect(STEP_FRAMES['spotify-export'].map((f) => f.title)).toEqual(['Account', 'Privacy settings', 'my_spotify_data.zip', 'Transfer']);
    expect(stepFrame('spotify-export', 2)?.rows[stepFrame('spotify-export', 2)!.tap]).toBe('YourLibrary.json');
  });

  it('nothing for a step that does not exist', () => {
    expect(stepFrame('spotify-export', 9)).toBeNull();
    expect(stepFrame('nope', 0)).toBeNull();
  });

  it('has no em dashes', () => {
    const all = Object.values(STEP_FRAMES).flatMap((fs) => fs.flatMap((f) => [f.app, f.title, ...f.rows])).join(' ');
    expect(all).not.toContain('\u2014');
  });
});
