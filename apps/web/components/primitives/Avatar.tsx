'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/** First letter of `name`, falling back to `email`, falling back to '?'. */
function initialFor(name?: string | null, email?: string | null): string {
  const source = (name || email || '').trim();
  return source ? source[0]!.toUpperCase() : '?';
}

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  /** Sizing, background, and text classes — each call site keeps its own
   *  look (circle size, ember/cover background, text size/color). */
  className?: string;
}

/** Presentational avatar circle used everywhere a user's picture shows: the
 *  image on top when `src` is set, otherwise the initial letter. If the
 *  image fails to load (broken URL, avatar removed on the server), `onError`
 *  hides it so the letter shows instead of a broken-image icon. */
export function Avatar({ src, name, email, className }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  // A new src (picture just uploaded/removed) deserves a fresh attempt.
  // Adjusting state during render (rather than in an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setErrored(false);
  }

  const showImage = !!src && !errored;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-full shrink-0 grid place-items-center font-bold',
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        initialFor(name, email)
      )}
    </div>
  );
}
