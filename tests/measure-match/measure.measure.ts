// @vitest-environment node
/** Measures the by-name matcher on tests/measure-match/sample.tsv: the real
 *  `matchItems` (player.py match, anonymous YouTube Music search) and the real
 *  scorer, in the batches of 8 a transfer uses. Prints the accepted / review /
 *  missing split and lists every accepted pick whose artist or title looks
 *  off, so systematic mistakes are visible. Writes results.json and summary.txt beside it.
 *  Needs network; not part of the normal suite. See vitest.config.mts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { matchItems } from '@/lib/import/match';
import type { SourceItem } from '@/lib/import/types';

const dir = `${__dirname}/`;

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function rows() {
  return readFileSync(`${dir}sample.tsv`, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split('\t'));
}

describe('by-name match measurement', () => {
  it('measures the split', async () => {
    const data = rows();
    const items: SourceItem[] = data.map(([, title, artist], position) => ({
      position,
      title,
      artists: artist.split(', '),
      artist,
      durationMs: null,
      explicit: null,
      uri: null,
    }));
    const out: { cat: string; src: string; status: string; score: number | null; got: string }[] = [];
    for (let i = 0; i < items.length; i += 8) {
      const batch = items.slice(i, i + 8);
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await matchItems(batch);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        }
      }
      res.forEach((r, k) => {
        const top = r.candidates[0];
        out.push({
          cat: data[i + k][0],
          src: `${batch[k].title} | ${batch[k].artist}`,
          status: r.status,
          score: r.confidence,
          got: top ? `${top.track.title} | ${top.artists.join(', ')} | ${top.videoType ?? '?'}` : '(nothing)',
        });
      });
      await new Promise((r) => setTimeout(r, 1500));
    }
    writeFileSync(`${dir}results.json`, JSON.stringify(out, null, 1));

    const lines: string[] = [];
    const say = (...a: unknown[]) => lines.push(a.join(' '));
    const split = (rs: typeof out) => {
      const c = { accepted: 0, review: 0, missing: 0 } as Record<string, number>;
      rs.forEach((r) => c[r.status]++);
      return `${rs.length}: accepted ${c.accepted}, review ${c.review}, missing ${c.missing}`;
    };
    say('TOTAL', split(out));
    for (const cat of [...new Set(out.map((o) => o.cat))]) say(cat.padEnd(10), split(out.filter((o) => o.cat === cat)));
    say('--- accepted picks whose artist shares no word with the source artist (check by eye)');
    for (const o of out.filter((x) => x.status === 'accepted')) {
      const [, sa] = o.src.split(' | ');
      const [, ga] = o.got.split(' | ');
      const wanted = fold(sa).split(' ').filter((w) => w.length > 2);
      if (!wanted.some((w) => fold(ga ?? '').includes(w))) say('  ', o.score, o.src, '=>', o.got);
    }
    say('--- review and missing');
    for (const o of out.filter((x) => x.status !== 'accepted')) say('  ', o.status, o.score, o.src, '=>', o.got);
    say('--- all accepted');
    for (const o of out.filter((x) => x.status === 'accepted')) say('  ', o.score, o.src, '=>', o.got);
    // vitest.setup silences console, so the report goes to a file.
    writeFileSync(`${dir}summary.txt`, lines.join('\n') + '\n');
  });
});
