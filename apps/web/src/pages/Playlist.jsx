import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import TrackList from '../components/TrackList.jsx';
import { Icon, PlayIcon } from '../components/Icons.jsx';
import { api } from '../api/client.js';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

export default function Playlist() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { playTrack } = usePlayer();
  const { refreshPlaylists } = useLibrary();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    setData(null);
    api.getPlaylist(id)
      .then(setData)
      .catch((e) => setError(e.message ?? 'Failed to load playlist'));
  }, [id]);

  if (error) {
    return (
      <div className="empty">
        Playlist not found.<br />
        <Link to="/library" style={{ color: 'var(--accent)' }}>Back to library</Link>
      </div>
    );
  }
  if (!data) return <div className="empty">Loading…</div>;

  const { playlist, tracks } = data;

  const removePlaylist = async () => {
    if (!confirm(`Delete "${playlist.name}"?`)) return;
    await api.deletePlaylist(id);
    await refreshPlaylists();
    navigate('/library');
  };

  const removeTrack = (trackId) => {
    // Optimistic — remove from local state, reconcile on failure.
    setData((d) => ({ ...d, tracks: d.tracks.filter((t) => t.id !== trackId) }));
    api.removeFromPlaylist(id, trackId).catch(() => {
      api.getPlaylist(id).then(setData);
    });
  };

  return (
    <div>
      <div className="playlist-header">
        <div className="playlist-cover" />
        <div>
          <div className="playlist-eyebrow">Playlist</div>
          <h1 className="playlist-title">{playlist.name}</h1>
          <div className="playlist-meta">{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</div>
        </div>
      </div>
      <div className="playlist-actions">
        <button
          className="play-btn playlist-play"
          onClick={() => tracks.length && playTrack(tracks[0], tracks)}
          disabled={!tracks.length}
          title="Play"
        >
          <PlayIcon size={20} />
        </button>
        <button className="btn-icon" onClick={removePlaylist} title="Delete playlist">
          <Icon name="trash" />
        </button>
      </div>
      {tracks.length === 0 ? (
        <div className="empty">
          No tracks yet.<br />
          Use the <Icon name="plus" size={12} /> button on any search result to add tracks here.
        </div>
      ) : (
        <TrackList tracks={tracks} onRemove={removeTrack} />
      )}
    </div>
  );
}
