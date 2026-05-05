import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import searchRouter from './routes/search.js';
import tracksRouter from './routes/tracks.js';
import playlistsRouter from './routes/playlists.js';
import likesRouter from './routes/likes.js';
import historyRouter from './routes/history.js';
import youtubeRouter from './routes/youtube.js';
import discordRouter from './routes/discord.js';
import { initDiscord } from './discord.js';
import { requireAuth } from './middleware/auth.js';

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/search', searchRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/discord', discordRouter);

app.use('/api/playlists', requireAuth, playlistsRouter);
app.use('/api/likes', requireAuth, likesRouter);
app.use('/api/history', requireAuth, historyRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API listening on :${port}`);
  initDiscord();
});
