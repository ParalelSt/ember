import type { IconProps } from './phosphor';

/** The Ember flame logo. Kept apart from the app icon set so swapping icon
 *  libraries never changes the brand mark (it is the original outline flame). */
export function FlameIcon({
  size = 24,
  width = size,
  height = size,
  strokeWidth = 2,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  className,
  ...props
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
      className={['ember-logo', className].filter(Boolean).join(' ')}
      aria-hidden={props['aria-label'] !== undefined ? undefined : (props['aria-hidden'] ?? true)}
    >
      <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
    </svg>
  );
}
