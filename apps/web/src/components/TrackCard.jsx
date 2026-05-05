import { usePlayer } from '../context/PlayerContext.jsx';
import { PlayIcon } from './Icons.jsx';

export default function TrackCard({ track, list }) {
  const { playTrack } = usePlayer();
  return (
    <div className="card" onClick={() => playTrack(track, list)}>
      <div className="art">
        {track.artworkUrl && <img src={track.artworkUrl} alt="" loading="lazy" />}
      </div>
      <div className="title">{track.title}</div>
      <div className="subtitle">{track.artist}</div>
      <button className="play-fab" onClick={(e) => { e.stopPropagation(); playTrack(track, list); }}>
        <PlayIcon size={16} />
      </button>
    </div>
  );
}
