import { describe, expect, it } from 'vitest';
import { chartColor, chartMeta, chartTitle, POPULAR_COLOR, snapshotName } from '@/lib/chartsView';
import { CHARTS, UNKNOWN_CHART_COLOR } from '@/lib/genres/taxonomy';

const tracks = (n: number) => Array.from({ length: n }, () => ({}) as never);

describe('chartsView', () => {
  it('colours and names a chart from the taxonomy, falling back for new ones', () => {
    expect(chartColor('popular')).toBe(POPULAR_COLOR);
    expect(chartColor('rock')).toBe(CHARTS.find((c) => c.slug === 'rock')!.color);
    expect(chartColor('k-pop')).toBe(UNKNOWN_CHART_COLOR);
    expect(chartTitle('popular', 'x')).toBe('Popular now');
    expect(chartTitle('country', 'Country & Americana')).toBe('Country & Americana');
    expect(chartTitle('k-pop', 'K-Pop')).toBe('K-Pop');
  });

  it('says "Updated daily" while fresh and how old it is once stale', () => {
    const since = () => '3 hours ago';
    expect(chartMeta({ tracks: tracks(50), fetchedAt: 'x', stale: false }, since)).toEqual(['50 songs', 'Updated daily']);
    expect(chartMeta({ tracks: tracks(1), fetchedAt: 'x', stale: true }, since)).toEqual(['1 song', 'Updated 3 hours ago']);
    expect(chartMeta({ tracks: [], fetchedAt: null, stale: true }, since)).toEqual(['0 songs']);
  });

  it('names a saved snapshot after the list and the day', () => {
    expect(snapshotName('Rock', 'chart', '16 Oct')).toBe('Rock chart, 16 Oct');
    expect(snapshotName('Balkan', 'mix', '')).toBe('Balkan mix');
  });
});
