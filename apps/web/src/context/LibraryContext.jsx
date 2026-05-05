import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

// Lifts liked/history/playlists/trending out of route-level components so
// navigating between Home/Search/Library doesn't re-fetch. Mutation helpers
// (toggleLike, recordPlay, etc.) update the cache optimistically.
const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const { user } = useAuth();
  const [liked, setLiked] = useState([]);
  const [history, setHistory] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [trending, setTrending] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);

  const refreshLikes = useCallback(
    () => api.listLikes().then(({ tracks }) => setLiked(tracks)).catch(() => {}),
    [],
  );
  const refreshHistory = useCallback(
    () => api.getHistory().then(({ tracks }) => setHistory(tracks)).catch(() => {}),
    [],
  );
  const refreshPlaylists = useCallback(
    () => api.listPlaylists().then(({ playlists }) => setPlaylists(playlists)).catch(() => {}),
    [],
  );
  const refreshTrending = useCallback(() => {
    setTrendingLoading(true);
    return api.getTrending()
      .then(({ tracks }) => setTrending(tracks))
      .catch(() => {})
      .finally(() => setTrendingLoading(false));
  }, []);

  // Trending is public — fetch once on mount.
  useEffect(() => { refreshTrending(); }, [refreshTrending]);

  // Auth-gated lists — fetch on login, clear on logout.
  useEffect(() => {
    if (!user) {
      setLiked([]);
      setHistory([]);
      setPlaylists([]);
      return;
    }
    refreshLikes();
    refreshHistory();
    refreshPlaylists();
  }, [user, refreshLikes, refreshHistory, refreshPlaylists]);

  const isLiked = useCallback((trackId) => liked.some(t => t.id === trackId), [liked]);

  const toggleLike = useCallback(async (track) => {
    const wasLiked = liked.some(t => t.id === track.id);
    // Optimistic update — flip locally, reconcile from server.
    setLiked(prev => wasLiked ? prev.filter(t => t.id !== track.id) : [track, ...prev]);
    try {
      if (wasLiked) await api.unlike(track.id);
      else await api.like(track);
    } catch {
      refreshLikes();
    }
  }, [liked, refreshLikes]);

  const recordPlayed = useCallback((track) => {
    if (!user) return;
    // Optimistic: bump to top, dedupe, cap.
    setHistory(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      return [track, ...filtered].slice(0, 50);
    });
    api.recordPlay(track).catch(() => refreshHistory());
  }, [user, refreshHistory]);

  const createPlaylist = useCallback(async (name) => {
    const { playlist } = await api.createPlaylist(name);
    setPlaylists(prev => [playlist, ...prev]);
    return playlist;
  }, []);

  const value = {
    liked, history, playlists, trending, trendingLoading,
    isLiked, toggleLike, recordPlayed, createPlaylist,
    refreshLikes, refreshHistory, refreshPlaylists, refreshTrending,
  };

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export const useLibrary = () => useContext(LibraryContext);
