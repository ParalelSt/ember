import { useEffect, useState } from 'react';
import TrackList from '../components/TrackList.jsx';
import { api } from '../api/client.js';

export default function Search() {
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.search(q).then(({ tracks }) => setTracks(tracks)).catch(() => {}).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <input
        autoFocus
        className="search-input"
        placeholder="What do you want to listen to?"
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      <h2 className="section-title" style={{ marginTop: 24 }}>
        {q ? `Results for "${q}"` : 'Trending'}
      </h2>
      {loading ? <div className="empty">Searching…</div> : <TrackList tracks={tracks} />}
    </div>
  );
}
