import type { Track } from '@/types/track';

/** What GET /api/mixes and GET /api/mixes/[key] answer. Shared by the
 *  routes and the client. */

export interface MixTile {
  key: string;
  /** "Rock & Metal" (the card adds its own "MIX" label). */
  title: string;
  /** "Gojira, Tool, Metallica and more". */
  subtitle: string;
  cover: { artworkUrls: string[]; color: string };
  builtAt: string;
  count: number;
}

export interface MixesPayload {
  /** Enough listening for mixes (or not known yet while the first build runs). */
  eligible: boolean;
  /** A build for this member is queued or running. */
  building: boolean;
  mixes: MixTile[];
}

export interface MixPayload {
  key: string;
  title: string;
  subtitle: string;
  cover: { artworkUrls: string[]; color: string };
  builtAt: string;
  tracks: Track[];
}

export const MIX_KEY_RE = /^[a-z0-9-]{1,40}$/;

/** The mix page's line under the title: "Built today from Gojira, Tool,
 *  Metallica", from the subtitle's names. */
export function builtLine(mix: Pick<MixPayload, 'subtitle' | 'builtAt'>, now: number): string {
  const names = mix.subtitle.replace(/\s+and more$/, '');
  const at = Date.parse(mix.builtAt);
  let when = 'today';
  if (!Number.isNaN(at)) {
    const days = Math.floor((startOfDay(now) - startOfDay(at)) / 86400000);
    if (days === 1) when = 'yesterday';
    else if (days > 1) when = `${days} days ago`;
  }
  return names ? `Built ${when} from ${names}` : `Built ${when}`;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
