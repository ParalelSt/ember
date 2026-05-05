import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import PlayerBar from './components/PlayerBar.jsx';
import Home from './pages/Home.jsx';
import Search from './pages/Search.jsx';
import Library from './pages/Library.jsx';
import Playlist from './pages/Playlist.jsx';
import Auth from './pages/Auth.jsx';
import { useAuth } from './context/AuthContext.jsx';

export default function App() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Auth />;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/library" element={<Library />} />
          <Route path="/playlist/:id" element={<Playlist />} />
        </Routes>
      </main>
      <PlayerBar />
    </div>
  );
}
