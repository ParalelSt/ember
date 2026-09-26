/** The spacing scale as data, for the
 *  /dizajn "Spacing scale" rulers. The tokens themselves live in
 *  app/globals.css `@theme` as `--spacing-<name>`; lib/spacing.test.ts
 *  checks both against the spec's table. `ruler` is a literal width class
 *  so Tailwind generates it. */
export interface SpacingStep {
  name: string;
  px: number;
  role: string;
  ruler: string;
}

export const SPACING_SCALE: SpacingStep[] = [
  { name: 'inset', px: 4, role: 'icon to label inside a control, chip padding', ruler: 'w-inset' },
  { name: 'cluster', px: 8, role: 'eyebrow to title, title to meta, buttons in an action bar', ruler: 'w-cluster' },
  { name: 'row', px: 12, role: 'inside a row or card: art to text, row padding', ruler: 'w-row' },
  { name: 'block', px: 16, role: 'a heading to its content, a description under a title', ruler: 'w-block' },
  { name: 'stack', px: 24, role: 'header to action bar, action bar to list', ruler: 'w-stack' },
  { name: 'section', px: 40, role: 'between page sections', ruler: 'w-section' },
  { name: 'page', px: 24, role: 'main column padding, phone', ruler: 'w-page' },
  { name: 'page-lg', px: 32, role: 'main column padding, desktop', ruler: 'w-page-lg' },
  { name: 'hit', px: 40, role: 'phone hit box for icon buttons', ruler: 'w-hit' },
];
