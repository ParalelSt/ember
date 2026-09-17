/** A stand-in Discord webhook for crash-report tests. Records every POST as
 *  one JSON line ({ path, contentType, body }) so a test can assert what
 *  would have reached the channel without touching the real one.
 *
 *      node tests/fake-discord.mjs <record-file> [port] [status]
 *
 *  Port 0 (the default) picks a free one; the chosen port is printed as the
 *  first stdout line, "listening <port>". `status` (default 204) is what every
 *  POST answers, so a test can simulate Discord refusing.
 */
import fs from 'node:fs';
import http from 'node:http';

const [recordFile, portArg = '0', statusArg = '204'] = process.argv.slice(2);
if (!recordFile) {
  console.error('usage: node tests/fake-discord.mjs <record-file> [port] [status]');
  process.exit(2);
}
const status = Number(statusArg);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'POST') {
      fs.appendFileSync(
        recordFile,
        JSON.stringify({
          path: req.url,
          contentType: req.headers['content-type'] ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        }) + '\n',
      );
    }
    res.writeHead(status);
    res.end();
  });
});

server.listen(Number(portArg), '127.0.0.1', () => {
  console.log(`listening ${server.address().port}`);
});
// Exit straight away: close() would wait on the poster's keep-alive socket.
process.on('SIGTERM', () => process.exit(0));
