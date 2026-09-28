import type { PlaybackContext } from '@/types/track';

/** The full-screen player's title: where the queue was started from, as a
 *  small kicker ("Playing from playlist") over its name ("Road trip"). A
 *  song started on its own (or nothing known) says just "Now playing". */
export interface ContextTitle {
  kicker: string;
  name: string | null;
}

const NOW_PLAYING: ContextTitle = { kicker: 'Now playing', name: null };

export function contextTitle(context: PlaybackContext | null | undefined): ContextTitle {
  if (!context) return NOW_PLAYING;
  switch (context.type) {
    case 'playlist':
      return { kicker: 'Playing from playlist', name: context.playlistName || null };
    case 'album':
      return { kicker: 'Playing from album', name: context.albumTitle || null };
    case 'artist':
      return { kicker: 'Playing from artist', name: context.artistName || null };
    case 'liked':
      return { kicker: 'Playing from', name: 'Liked songs' };
    case 'history':
      return { kicker: 'Playing from', name: 'Recently played' };
    case 'uploads':
      return { kicker: 'Playing from', name: 'Uploads' };
    case 'radio':
      return { kicker: 'Playing from', name: 'Radio' };
    case 'search': {
      const q = context.query?.trim();
      return { kicker: 'Playing from search', name: q ? `"${q}"` : null };
    }
    case 'single':
      return NOW_PLAYING;
  }
}
