import { Icon, PlayIcon, PauseIcon } from './Icons.jsx';
import AddToPlaylistMenu from './AddToPlaylistMenu.jsx';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Pass `onRemove(trackId)` to render an X button per row (used on playlist pages).
export default function TrackList({ tracks, showAlbum = true, onRemove }) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { user } = useAuth();
  const { isLiked, toggleLike } = useLibrary();

  const onLike = (track) => {
    if (!user) return alert('Sign in to like tracks');
    toggleLike(track);
  };

  if (!tracks?.length) return <div className="empty">No tracks</div>;

  return (
    <div className="track-list">
      {tracks.map((t) => {
        const playing = current?.id === t.id;
        const liked = isLiked(t.id);
        return (
          <div
            key={t.id}
            className={'track-row' + (playing ? ' playing' : '')}
            onDoubleClick={() => playTrack(t, tracks)}
          >
            <div className="num">
              {playing && isPlaying
                ? <button className="btn-icon" onClick={toggle}><PauseIcon size={14} /></button>
                : <button className="btn-icon" onClick={() => playing ? toggle() : playTrack(t, tracks)}>
                    <PlayIcon size={14} />
                  </button>}
            </div>
            <div className="meta" onClick={() => playTrack(t, tracks)}>
              {t.artworkUrl && <img src={t.artworkUrl} alt="" />}
              <div className="text">
                <div className="t">{t.title}</div>
                <div className="a">{t.artist}</div>
              </div>
            </div>
            {showAlbum ? <div className="album">{t.album}</div> : <div />}
            <div className="dur">{fmt(t.durationSec)}</div>
            <div className="track-actions">
              <AddToPlaylistMenu track={t} />
              <button
                className={'btn-icon heart' + (liked ? ' liked' : '')}
                onClick={() => onLike(t)}
                title={liked ? 'Unlike' : 'Like'}
              >
                <Icon name="heart" size={16} fill={liked ? 'currentColor' : 'none'} />
              </button>
              {onRemove && (
                <button
                  className="btn-icon"
                  onClick={() => onRemove(t.id)}
                  title="Remove from playlist"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
