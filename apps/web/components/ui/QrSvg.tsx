'use client';

import { useMemo } from 'react';
import { encodeQr, qrSvgPath } from '@/lib/qr';

/** A QR code drawn as one SVG path, dark on white with the quiet zone the
 *  spec asks for, so phone cameras read it in either app theme. Shared by
 *  the carlist invite and QR sign-in. */
export function QrSvg({
  value,
  size = 176,
  className,
  label = 'QR code',
}: {
  value: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const qr = useMemo(() => encodeQr(value), [value]);
  const quiet = 4;
  const box = qr.size + quiet * 2;
  return (
    <svg
      data-testid="qr"
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
    >
      {/* White whatever the theme: phone cameras want dark on light. */}
      <rect x={-quiet} y={-quiet} width={box} height={box} rx={2} fill="#fff" />
      <path d={qrSvgPath(qr)} fill="#000" />
    </svg>
  );
}
