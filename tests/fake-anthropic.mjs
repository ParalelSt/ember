/** Fake Anthropic API + Discord webhook for the UI test.
 *
 *      node tests/fake-anthropic.mjs &
 *
 *  Ports: FAKE_ANTHROPIC_PORT (4311), FAKE_DISCORD_PORT (4312).
 *  ai-triage.test.mjs runs its own fakes in-process and doesn't need this. */
import http from 'node:http';

const ANTHROPIC_PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 4311);
const DISCORD_PORT = Number(process.env.FAKE_DISCORD_PORT ?? 4312);

const TRIAGE = {
  summary: 'Playback stops a few seconds into every track.',
  likelyCause: 'The stream proxy is returning 403 from YouTube on expired URLs, and the client gives up after three retries.',
  area: 'streaming',
  severity: 'high',
  confidence: 'medium',
  nextSteps: [
    'Update yt-dlp on the host',
    'Check the cookies.txt path in .env.local',
    'Look for 403s in logs/errors-*.jsonl',
  ],
};

http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(TRIAGE) }] }));
  });
}).listen(ANTHROPIC_PORT, '127.0.0.1', () => console.log(`fake anthropic on ${ANTHROPIC_PORT}`));

http.createServer((req, res) => {
  req.resume();
  req.on('end', () => { res.writeHead(204); res.end(); });
}).listen(DISCORD_PORT, '127.0.0.1', () => console.log(`fake discord on ${DISCORD_PORT}`));
