import { ANDROID_NAV_PX } from '@/components/library/options/mobileplayer';

/** Android's three-button navigation bar, drawn OVER the bottom of the mock
 *  phone frame the way the real one is drawn over an edge-to-edge WebView:
 *  48dp tall, back triangle, home circle, recents square. It is deliberately
 *  on top of everything, because that is the bug being designed against. */
export function AndroidNavStrip() {
  return (
    <div
      data-testid="android-nav-strip"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-center justify-around bg-black/70 backdrop-blur-xs"
      style={{ height: ANDROID_NAV_PX }}
    >
      {/* Back: a triangle pointing left. */}
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white/85">
        <path d="M16 3 6 12l10 9z" />
      </svg>
      {/* Home: a circle. */}
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white/85" strokeWidth="2.5">
        <circle cx="12" cy="12" r="8" />
      </svg>
      {/* Recents: a rounded square. */}
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white/85" strokeWidth="2.5">
        <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      </svg>
    </div>
  );
}
