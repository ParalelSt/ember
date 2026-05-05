import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { playlists, createPlaylist } = useLibrary();
  const navigate = useNavigate();

  const create = async () => {
    const name = prompt('Playlist name?');
    if (!name) return;
    const playlist = await createPlaylist(name);
    navigate(`/playlist/${playlist.id}`);
  };

  return (
    <aside className="sidebar">
      <div className="brand"><span className="dot" />Ember</div>
      <NavLink to="/" end className={({isActive}) => 'nav-item' + (isActive ? ' active' : '')}>
        <Icon name="home" /> Home
      </NavLink>
      <NavLink to="/search" className={({isActive}) => 'nav-item' + (isActive ? ' active' : '')}>
        <Icon name="search" /> Search
      </NavLink>
      <NavLink to="/library" className={({isActive}) => 'nav-item' + (isActive ? ' active' : '')}>
        <Icon name="library" /> Library
      </NavLink>

      <div className="desktop-only" style={{ marginTop: 16 }}>
        <div className="sidebar-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Playlists</span>
          {user && <button className="btn-icon" onClick={create} title="New playlist"><Icon name="plus" size={14} /></button>}
        </div>
        {!user && <div className="playlist-link">Sign in to create</div>}
        {playlists.map(p => (
          <NavLink key={p.id} to={`/playlist/${p.id}`} className="playlist-link">{p.name}</NavLink>
        ))}
      </div>

      {user && (
        <div className="account desktop-only">
          <div className="account-info">
            <div className="account-avatar">{user.email?.[0]?.toUpperCase() ?? '?'}</div>
            <div className="account-email" title={user.email}>{user.email}</div>
          </div>
          <button className="signout-btn" onClick={signOut}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
