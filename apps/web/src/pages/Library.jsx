import { useState } from 'react';
import { Link } from 'react-router-dom';
import TrackList from '../components/TrackList.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

export default function Library() {
  const { user } = useAuth();
  const { liked, history, playlists } = useLibrary();
  const [tab, setTab] = useState('liked');

  if (!user) return <div className="empty">Sign in to see your library</div>;

  return (
    <div>
      <h2 className="section-title">Your library</h2>
      <div className="library-tabs">
        {['liked', 'recent', 'playlists'].map(t => (
          <button key={t}
            className={'btn' + (tab === t ? ' btn-primary' : '')}
            onClick={() => setTab(t)}
          >
            {t === 'liked' ? 'Liked' : t === 'recent' ? 'Recently played' : 'Playlists'}
          </button>
        ))}
      </div>

      {tab === 'liked' && <TrackList tracks={liked} />}
      {tab === 'recent' && <TrackList tracks={history} />}
      {tab === 'playlists' && (
        <div className="grid">
          {playlists.map(p => (
            <Link key={p.id} to={`/playlist/${p.id}`} className="card">
              <div className="art" style={{ background: 'linear-gradient(135deg, #ff2d2d 0%, #4a0000 100%)' }} />
              <div className="title">{p.name}</div>
              <div className="subtitle">Playlist</div>
            </Link>
          ))}
          {!playlists.length && <div className="empty">No playlists yet</div>}
        </div>
      )}
    </div>
  );
}
