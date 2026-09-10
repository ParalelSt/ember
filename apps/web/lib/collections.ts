import type { PlaybackContext } from '../types/track';

/** One place that knows what a "collection" is: a user playlist or one of the
 *  three system lists. Routes, pin ids and titles are encoded here so pages,
 *  the sidebar, the Library shelf and the offline view never disagree. Kept
 *  free of React and Next so a plain Node test can import it. */
export type CollectionRef =
  | { kind: 'playlist'; id: string }
  | { kind: 'liked' }
  | { kind: 'recent' }
  | { kind: 'uploads' };
export type SystemKind = Exclude<CollectionRef['kind'], 'playlist'>;
export type CollectionIcon = 'heart' | 'clock' | 'upload';

export const SYSTEM_COLLECTIONS: readonly SystemKind[] = ['liked', 'recent', 'uploads'];

const SYSTEM = {
  liked: { title: 'Liked songs', href: '/library/liked', icon: 'heart' },
  recent: { title: 'Recently played', href: '/library/recent', icon: 'clock' },
  uploads: { title: 'Uploads', href: '/library/uploads', icon: 'upload' },
} as const satisfies Record<SystemKind, { title: string; href: string; icon: CollectionIcon }>;

export function hrefFor(ref: CollectionRef): string {
  return ref.kind === 'playlist' ? `/playlist/${ref.id}` : SYSTEM[ref.kind].href;
}
/** Pin ids: a playlist's own id, or the literal kind. The offline index stores these. */
export function pinIdFor(ref: CollectionRef): string {
  return ref.kind === 'playlist' ? ref.id : ref.kind;
}
export function refFromPinId(pinId: string): CollectionRef {
  return (SYSTEM_COLLECTIONS as readonly string[]).includes(pinId)
    ? { kind: pinId as SystemKind }
    : { kind: 'playlist', id: pinId };
}
export function titleFor(ref: CollectionRef, name?: string): string {
  return ref.kind === 'playlist' ? (name ?? 'Playlist') : SYSTEM[ref.kind].title;
}
export function iconFor(ref: CollectionRef): CollectionIcon | null {
  return ref.kind === 'playlist' ? null : SYSTEM[ref.kind].icon;
}
export function contextFor(ref: CollectionRef, name?: string): PlaybackContext {
  switch (ref.kind) {
    case 'playlist': return { type: 'playlist', playlistId: ref.id, playlistName: name ?? 'Playlist' };
    case 'liked': return { type: 'liked' };
    case 'recent': return { type: 'history' };
    case 'uploads': return { type: 'uploads' };
  }
}
/** "Is this collection the one playing?" drives the Shuffle button's toggle mode. */
export function sameContext(a: PlaybackContext | null | undefined, b: PlaybackContext | null | undefined): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'playlist' && b.type === 'playlist') return a.playlistId === b.playlistId;
  if (a.type === 'album' && b.type === 'album') return a.albumId === b.albumId;
  return true;
}
export function countLabel(n: number, noun = 'song'): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
export interface SystemCollection { ref: CollectionRef; title: string; href: string; pinId: string; icon: CollectionIcon }
export function systemCollections(): SystemCollection[] {
  return SYSTEM_COLLECTIONS.map((kind) => {
    const ref: CollectionRef = { kind };
    return { ref, title: titleFor(ref), href: hrefFor(ref), pinId: pinIdFor(ref), icon: SYSTEM[kind].icon };
  });
}
