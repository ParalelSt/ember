import type { PickerOption } from '@/components/library/options';

export type TrendingOption = 'ranked-cards' | 'chart-list' | 'hero-list';
export type TrendingView = 'shelf' | 'show-all';
export type TrendingData = 'fresh' | 'stale';

/** Candidates for the reworked Home "Trending right now" shelf, in picker
 *  order. `id` is what persists to localStorage; `description` is the line
 *  under the preview. */
export const TRENDING_OPTIONS: (PickerOption & { id: TrendingOption })[] = [
  {
    id: 'ranked-cards',
    name: 'Ranked cards',
    description:
      "Today's card shelf, with a large rank number on each cover and a small up, down or new marker beside the artist. Closest to the other Home shelves.",
  },
  {
    id: 'chart-list',
    name: 'Chart list',
    description:
      'A compact ranked list of the top 10 in two columns, like a chart widget: rank, cover, title, artist and movement, with play on hover. One column on phone.',
  },
  {
    id: 'hero-list',
    name: 'Hero + list',
    description:
      'Number 1 as a wide feature card with its cover and a play button, next to a short ranked list of 2 to 6. Stacked on phone.',
  },
];

export const TRENDING_VIEWS: (PickerOption & { id: TrendingView })[] = [
  { id: 'shelf', name: 'Shelf', description: 'Home, with the trending shelf between the other shelves.' },
  {
    id: 'show-all',
    name: 'Show all open',
    description: 'Show all opens the whole chart as a collection page, ranked 1 to 50, like Liked songs. No new page in the nav.',
  },
];

export const TRENDING_DATA: (PickerOption & { id: TrendingData })[] = [
  { id: 'fresh', name: 'Fresh', description: 'The chart refreshed within the last few hours: no note.' },
  {
    id: 'stale',
    name: 'Stale',
    description: 'YouTube could not be reached, so the last good chart shows with an "Updated 3 hours ago" note.',
  },
];
