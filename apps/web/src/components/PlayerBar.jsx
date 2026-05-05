import { useCallback, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { Icon, PlayIcon, PauseIcon } from './Icons.jsx';

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Click-or-drag along a horizontal rail. Pointer events cover mouse + touch.
function useRailDrag(onChange) {
  const ref = useRef(null);
  const apply = useCallback((clientX) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(pct);
  }, [onChange]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    apply(e.clientX);
    const onMove = (ev) => apply(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [apply]);

  return { ref, onPointerDown };
}

export default function PlayerBar() {
  const { current, isPlaying, position, duration, volume, toggle, next, prev, seek, setVolume } = usePlayer();
  const seekRail = useRailDrag(useCallback((pct) => seek(pct * (duration || 0)), [seek, duration]));
  const volRail = useRailDrag(setVolume);

  const pct = duration ? (position / duration) * 100 : 0;

  return (
    <div className="player-bar player">
      <div className="now-playing">
        {current?.artworkUrl && <img src={current.artworkUrl} alt="" />}
        <div className="text">
          <div className="t">{current?.title ?? 'Nothing playing'}</div>
          <div className="a">{current?.artist ?? ''}</div>
        </div>
      </div>

      <div className="player-controls">
        <div className="row">
          <button className="btn-icon" onClick={prev} aria-label="Previous"><Icon name="prev" /></button>
          <button className="play-btn" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button className="btn-icon" onClick={next} aria-label="Next"><Icon name="next" /></button>
        </div>
        <div className="seek">
          <span className="time">{fmt(position)}</span>
          <div className="bar" ref={seekRail.ref} onPointerDown={seekRail.onPointerDown}>
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="time">{fmt(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        <Icon name="volume" />
        <div className="volume">
          <div className="bar" ref={volRail.ref} onPointerDown={volRail.onPointerDown}>
            <div className="fill" style={{ width: `${volume * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
