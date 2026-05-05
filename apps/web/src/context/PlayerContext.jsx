import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useLibrary } from './LibraryContext.jsx';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const { recordPlayed } = useLibrary();
  const audioRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);

  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }

  const current = queue[index] ?? null;

  useEffect(() => {
    const a = audioRef.current;
    a.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (!current) {
      a.pause();
      a.removeAttribute('src');
      setIsPlaying(false);
      setPosition(0);
      setDuration(0);
      return;
    }
    a.src = current.streamUrl;
    a.load();
    a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    recordPlayed(current);
  }, [current?.id, recordPlayed]);

  useEffect(() => {
    const a = audioRef.current;
    const onTime = () => setPosition(a.currentTime || 0);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => next();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
    };
  });

  const playTrack = useCallback((track, list) => {
    if (list && list.length) {
      const i = list.findIndex(t => t.id === track.id);
      setQueue(list);
      setIndex(i >= 0 ? i : 0);
    } else {
      setQueue([track]);
      setIndex(0);
    }
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!current) return;
    if (a.paused) a.play(); else a.pause();
  }, [current]);

  const next = useCallback(() => {
    setIndex(i => (i < queue.length - 1 ? i + 1 : i));
  }, [queue.length]);

  const prev = useCallback(() => {
    const a = audioRef.current;
    if (a.currentTime > 3) { a.currentTime = 0; return; }
    setIndex(i => (i > 0 ? i - 1 : i));
  }, []);

  const seek = useCallback((sec) => {
    const a = audioRef.current;
    a.currentTime = Math.max(0, Math.min(sec, a.duration || 0));
  }, []);

  // Push current track + play state to Discord rich presence (no-op if
  // DISCORD_APP_ID isn't set on the server). Server has its own 15s rate limit.
  useEffect(() => {
    api.updateDiscord(current, isPlaying).catch(() => {});
  }, [current?.id, isPlaying]);

  // Native media session metadata — lock-screen controls on Android/iOS,
  // Bluetooth headphone buttons, OS-level play/pause widgets.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!current) { navigator.mediaSession.metadata = null; return; }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title ?? '',
      artist: current.artist ?? '',
      album: current.album ?? '',
      artwork: current.artworkUrl ? [{ src: current.artworkUrl, sizes: '512x512' }] : [],
    });
  }, [current?.id]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const a = audioRef.current;
    navigator.mediaSession.setActionHandler('play', () => a.play());
    navigator.mediaSession.setActionHandler('pause', () => a.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('seekto', (e) => {
      if (typeof e.seekTime === 'number') seek(e.seekTime);
    });
    return () => {
      ['play','pause','previoustrack','nexttrack','seekto'].forEach(
        (act) => navigator.mediaSession.setActionHandler(act, null),
      );
    };
  }, [prev, next, seek]);

  const value = useMemo(() => ({
    current, isPlaying, position, duration, volume, queue, index,
    playTrack, toggle, next, prev, seek, setVolume,
  }), [current, isPlaying, position, duration, volume, queue, index, playTrack, toggle, next, prev, seek]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);
