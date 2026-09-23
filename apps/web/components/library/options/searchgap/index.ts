import type { PickerOption } from '@/components/library/options';

/** Small desktop layout fix: the search overlay's wrapper in
 *  app/(app)/layout.tsx (`SearchOverlayContainer`, rendered directly above
 *  `data-app-scroller`) is `shrink-0 px-page-lg pt-page-lg`, no bottom
 *  padding. A scrolled page's content runs right up against the pill's
 *  bottom edge, which reads as the pill missing its lower half (owner's
 *  report: "the pc navbar is missing a portion at the bottom"). These four
 *  candidates are that one wrapper's bottom edge, nothing else. */
export type SearchGapId = 'now' | 'gap-sm' | 'gap-md' | 'gap-fade';

export interface SearchGapCandidate extends PickerOption {
  id: SearchGapId;
  /** The padding-bottom this candidate adds under the pill, in the token's
   *  pixel value (0 for "as it is"). Read directly off the rendered frame
   *  as `data-gap-px`, rather than out of computed CSS, so the check does
   *  not depend on Tailwind having run. */
  gapPx: 0 | 8 | 16;
  /** gap-sm only: the added padding keeps the pill's own bg-card colour
   *  instead of the page background, so the strip reads as part of the bar
   *  rather than as a stripe of empty page peeking through. */
  tintGap: boolean;
  /** gap-fade only: a short gradient at the top of the scroll area, so
   *  content fades out as it slides under the bar instead of being cut. */
  hasFade: boolean;
}

export const SEARCHGAP_RECOMMENDED: SearchGapId = 'gap-fade';
export const SEARCHGAP_RECOMMENDED_REASON =
  'Reads best at both sizes: at 1080p the fade hides the cut without costing much vertical room, and at 1440p the extra height only makes the fade more visible, never awkward, where a flat gap that size starts to look like an accidental blank band.';

export const SEARCHGAP_OPTIONS: SearchGapCandidate[] = [
  {
    id: 'now',
    name: 'As it is',
    description: 'No bottom padding under the pill, for comparison: content runs straight up to its bottom edge.',
    gapPx: 0,
    tintGap: false,
    hasFade: false,
  },
  {
    id: 'gap-sm',
    name: 'Small gap',
    description:
      '8px (spacing token cluster) added under the pill, kept in the bar’s own bg-card colour so it reads as part of the bar rather than a stripe of page showing through.',
    gapPx: 8,
    tintGap: true,
    hasFade: false,
  },
  {
    id: 'gap-md',
    name: 'Roomy gap',
    description: '16px (spacing token block) of plain page background under the pill: more breathing room, no colour trick.',
    gapPx: 16,
    tintGap: false,
    hasFade: false,
  },
  {
    id: 'gap-fade',
    name: 'Gap with a fade',
    description:
      '16px (block) under the pill, plus a short gradient at the top of the scroll area so content fades out as it slides under the bar instead of being cut off mid-line.',
    gapPx: 16,
    tintGap: false,
    hasFade: true,
  },
];
