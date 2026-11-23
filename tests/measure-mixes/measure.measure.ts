// @vitest-environment node
/** The mix measurement (tests/measure-mixes/README.md): rebuilds every active
 *  member's mixes from an export of a PocketBase copy with the real mix job,
 *  explains every song, and writes <MIX_SIM_DIR>/runs/<label>.json plus
 *  runs/stored.json (the mixes as the copy holds them). Not part of the
 *  normal suite; see vitest.config.mts.
 *
 *  MIX_SIM_DIR      the export (snapshot.sh's out dir). Required.
 *  MIX_SIM_LABEL    the run's name (default "run").
 *  MIX_SIM_FETCH=1  fetch a seed radio missing from radios.json (anonymous
 *                   YouTube Music, player.py radio-batch), then cache it.
 *  MIX_SIM_LOOKUPS=1  look up artists the copy lacks (MusicBrainz, and
 *                   Last.fm when LASTFM_API_KEY is set), paced like the app.
 *  MIX_SIM_ONLY     comma list of member ids (default: every active one). */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { loadExport, type RadioFetch } from '@/lib/mixes/sim/fileDeps';
import { runMeasure, storedRun, type Explainers } from '@/lib/mixes/sim/runner';
import { createRateLimiter } from '@/lib/genres/rateLimit';
import { lastfmTopTags, musicbrainzTags, musicbrainzUserAgent } from '@/lib/genres/sources';
import type { TagLookup } from '@/lib/genres/tagger';

/** The per-song rules' functions when the code under test has them (the
 *  same runner measures the old commit, which lacks them). */
async function explainers(): Promise<Explainers> {
  const out: Explainers = {};
  // Paths in variables so the old commit, which lacks these files, still loads this file.
  const signalPath = '@/lib/genres/songSignal';
  const familyPath = '@/lib/mixes/songFamily';
  const untaggedPath = '@/lib/mixes/untagged';
  try {
    const m = await import(/* @vite-ignore */ signalPath);
    out.signal = m.songSignal;
  } catch { /* old rules */ }
  try {
    const m = await import(/* @vite-ignore */ familyPath);
    out.resolve = (t, g) => {
      const v = m.resolveGenre(t, g);
      return { family: v.family, via: v.via };
    };
  } catch { /* old rules */ }
  try {
    const m = await import(/* @vite-ignore */ untaggedPath);
    out.homes = (radios, genres, own) => m.untaggedHomes(radios, genres, own);
  } catch { /* old rules */ }
  return out;
}

describe('mix measurement', () => {
  it('rebuilds every member', async () => {
    const dir = process.env.MIX_SIM_DIR;
    if (!dir) throw new Error('set MIX_SIM_DIR to the export dir');
    const label = process.env.MIX_SIM_LABEL || 'run';
    const exp = loadExport(path.resolve(dir));
    let fetchRadio: RadioFetch | null = null;
    if (process.env.MIX_SIM_FETCH === '1') {
      process.env.MUSIC_DIR ??= path.join(exp.dir, 'music');
      mkdirSync(process.env.MUSIC_DIR, { recursive: true });
      const yt = await import('@/lib/sources/youtube');
      fetchRadio = async (seeds, limit) => {
        console.log(`radio: fetching ${seeds.length} seed(s)`);
        return yt.fetchRadioBatch(seeds, limit);
      };
    }
    let musicbrainz: TagLookup | null = null;
    let lastfm: TagLookup | null = null;
    if (process.env.MIX_SIM_LOOKUPS === '1') {
      const mbPace = createRateLimiter(1);
      const userAgent = musicbrainzUserAgent(process.env.MUSICBRAINZ_CONTACT);
      musicbrainz = (name) => musicbrainzTags(name, { userAgent, pace: mbPace.take });
      const key = process.env.LASTFM_API_KEY?.trim();
      if (key) {
        const lfPace = createRateLimiter(4);
        lastfm = async (name) => { await lfPace.take(); return lastfmTopTags(name, key); };
      }
    }
    const explain = await explainers();
    const runs = path.join(exp.dir, 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(path.join(runs, 'stored.json'), JSON.stringify(storedRun(exp, explain), null, 1));
    const run = await runMeasure(exp, {
      label,
      explain,
      fetchRadio,
      musicbrainz,
      lastfm,
      only: process.env.MIX_SIM_ONLY ? process.env.MIX_SIM_ONLY.split(',') : undefined,
      warn: (m, d) => console.warn(m, d ?? ''),
      progress: (m) => console.log(m),
    });
    writeFileSync(path.join(runs, `${label}.json`), JSON.stringify(run, null, 1));
    console.log(`wrote ${path.join(runs, `${label}.json`)}: ${run.members.length} members, explainers: ${Object.keys(explain).join(', ') || 'none'}`);
  });
});
