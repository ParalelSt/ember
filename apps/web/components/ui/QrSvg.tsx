'use client';

import { useMemo } from 'react';
import { encodeQr, qrLogoArea, qrSvgPath, QrTooLongError, type QrCode } from '@/lib/qr';
import { FlameIcon } from '@/components/icons';

/** Level H when there is a logo (it recovers about 30% of the symbol), so
 *  the flame over the middle costs nothing. A value too long for H falls
 *  back to a plain level M code without the logo. */
function encode(value: string, logo: boolean): { qr: QrCode; logo: boolean } {
  if (logo) {
    try {
      return { qr: encodeQr(value, { ecLevel: 'H' }), logo: true };
    } catch (e) {
      if (!(e instanceof QrTooLongError)) throw e;
    }
  }
  return { qr: encodeQr(value), logo: false };
}

/** A QR code drawn as one SVG path, dark on white with the quiet zone the
 *  spec asks for, so phone cameras read it in either app theme. Shared by
 *  the carlist invite and QR sign-in. `logo` puts the Ember flame in the
 *  middle (the sign-in QR): its modules are left light and the flame sits
 *  on an accent tile inside that light square. */
export function QrSvg({
  value,
  size = 176,
  className,
  label = 'QR code',
  logo = false,
}: {
  value: string;
  size?: number;
  className?: string;
  label?: string;
  logo?: boolean;
}) {
  const { qr, logo: withLogo } = useMemo(() => encode(value, logo), [value, logo]);
  const area = withLogo ? qrLogoArea(qr) : null;
  const quiet = 4;
  const box = qr.size + quiet * 2;
  const tile = area ? area.span - 2 : 0;
  const flame = tile * 0.72;
  return (
    <svg
      data-testid="qr"
      data-ec={qr.ecLevel}
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
      <path d={qrSvgPath(qr, area ? { clear: area } : {})} fill="#000" />
      {area && (
        <g data-testid="qr-logo" shapeRendering="geometricPrecision">
          <rect x={area.start + 1} y={area.start + 1} width={tile} height={tile} rx={tile * 0.22} className="fill-ember" />
          <FlameIcon
            x={area.start + 1 + (tile - flame) / 2}
            y={area.start + 1 + (tile - flame) / 2}
            width={flame}
            height={flame}
            strokeWidth={2.4}
            fill="currentColor"
            className="text-ember-foreground"
            aria-hidden
          />
        </g>
      )}
    </svg>
  );
}
