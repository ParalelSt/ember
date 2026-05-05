import { Router } from 'express';
import path from 'node:path';
import { searchTracks, ensureDownloaded, getTrending } from '../sources/youtube.js';

const router = Router();

const MIME_BY_EXT = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ tracks: [] });
    const tracks = await searchTracks(q, { limit: 30 });
    res.json({ tracks });
  } catch (e) {
    next(e);
  }
});

router.get('/trending', async (req, res, next) => {
  try {
    const tracks = await getTrending({ country: req.query.country });
    res.json({ tracks });
  } catch (e) {
    next(e);
  }
});

router.get('/stream/:videoId', async (req, res, next) => {
  try {
    const filePath = await ensureDownloaded(req.params.videoId);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    // sendFile honors Range headers via the underlying `send` lib,
    // which is what makes <audio> seek work in the browser.
    res.sendFile(path.resolve(filePath), {
      headers: { 'Content-Type': mime },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
