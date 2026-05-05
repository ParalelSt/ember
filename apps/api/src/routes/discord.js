import { Router } from 'express';
import { updateDiscordActivity, clearDiscordActivity } from '../discord.js';

const router = Router();

// Local-only: only useful while you're on the same machine as Discord. No auth.
router.post('/update', (req, res) => {
  const { track, isPlaying } = req.body ?? {};
  if (track && isPlaying) updateDiscordActivity(track, true);
  else clearDiscordActivity();
  res.json({ ok: true });
});

export default router;
