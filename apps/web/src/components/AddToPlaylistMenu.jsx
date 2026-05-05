import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

// Click "+" to open a dropdown of the user's playlists; click a name to add the
// current track. Re-uses LibraryContext.playlists so it never re-fetches.
export default function AddToPlaylistMenu({ track }) {
  const { user } = useAuth();
  const { playlists, createPlaylist } = useLibrary();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const add = async (playlistId) => {
    setBusy(true);
    try {
      await api.addToPlaylist(playlistId, track);
      setOpen(false);
    } catch (e) {
      alert(`Add failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = prompt('New playlist name?');
    if (!name) return;
    setBusy(true);
    try {
      const playlist = await createPlaylist(name);
      await api.addToPlaylist(playlist.id, track);
      setOpen(false);
    } catch (e) {
      alert(`Create failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-menu" ref={ref}>
      <button
        className="btn-icon"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="Add to playlist"
        disabled={busy}
      >
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <div className="add-menu-dropdown" onClick={(e) => e.stopPropagation()}>
          <button className="add-menu-item add-menu-create" onClick={createAndAdd}>
            <Icon name="plus" size={12} /> New playlist
          </button>
          {playlists.length > 0 && <div className="add-menu-divider" />}
          {playlists.map(p => (
            <button key={p.id} className="add-menu-item" onClick={() => add(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
