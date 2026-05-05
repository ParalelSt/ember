import TrackCard from '../components/TrackCard.jsx';
import { useLibrary } from '../context/LibraryContext.jsx';

export default function Home() {
  const { history, trending, trendingLoading } = useLibrary();

  return (
    <div>
      {history.length > 0 && (
        <>
          <h2 className="section-title">Recently played</h2>
          <div className="grid">
            {history.slice(0, 12).map(t => <TrackCard key={t.id} track={t} list={history} />)}
          </div>
        </>
      )}
      <h2 className="section-title" style={{ marginTop: history.length > 0 ? 32 : 0 }}>
        Trending right now
      </h2>
      {trendingLoading && trending.length === 0
        ? <div className="empty">Loading…</div>
        : (
          <div className="grid">
            {trending.map(t => <TrackCard key={t.id} track={t} list={trending} />)}
          </div>
        )}
    </div>
  );
}
