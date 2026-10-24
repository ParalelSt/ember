// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { audioContentType, createStreamSlots, isPublicAddress, openUpstream, StreamRefusedError } from './streamProxy';

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['185.1.2.3', true],
    ['2a01:4f8:1c1d:699::1', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:8.8.8.8', true],
    ['not an ip', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe('openUpstream', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
  });

  async function serve(handler: http.RequestListener): Promise<number> {
    const s = http.createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return (s.address() as AddressInfo).port;
  }

  it('refuses this host and its network, by address and by name', async () => {
    const port = await serve((_q, res) => res.end('secret'));
    await expect(openUpstream(`http://127.0.0.1:${port}/`, { userAgent: 'Ember/test' })).rejects.toBeInstanceOf(StreamRefusedError);
    await expect(openUpstream(`http://localhost:${port}/`, { userAgent: 'Ember/test' })).rejects.toMatchObject({ code: 'EREFUSED' });
    await expect(openUpstream('http://[::1]:9/', { userAgent: 'Ember/test' })).rejects.toBeInstanceOf(StreamRefusedError);
  });

  it('refuses other schemes and addresses with credentials', async () => {
    const allowAddress = () => true;
    await expect(openUpstream('file:///etc/passwd', { userAgent: 'x', allowAddress })).rejects.toBeInstanceOf(StreamRefusedError);
    await expect(openUpstream('ftp://example.com/a', { userAgent: 'x', allowAddress })).rejects.toBeInstanceOf(StreamRefusedError);
    await expect(openUpstream('http://u:p@example.com/a', { userAgent: 'x', allowAddress })).rejects.toBeInstanceOf(StreamRefusedError);
  });

  it('streams an allowed station, sending the User-Agent and no ICY metadata request', async () => {
    let headers: http.IncomingHttpHeaders = {};
    const port = await serve((req, res) => {
      headers = req.headers;
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end('ID3audio');
    });
    const up = await openUpstream(`http://127.0.0.1:${port}/live`, { userAgent: 'Ember/1.2.3', allowAddress: () => true });
    expect(up.status).toBe(200);
    expect(up.headers['content-type']).toBe('audio/mpeg');
    const chunks: Buffer[] = [];
    for await (const c of up.body) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('ID3audio');
    expect(headers['user-agent']).toBe('Ember/1.2.3');
    expect(headers['icy-metadata']).toBeUndefined();
  });

  it('checks every redirect hop: a station that redirects into the private network is refused', async () => {
    const port = await serve((_q, res) => {
      res.writeHead(302, { Location: 'http://192.168.1.1/admin' });
      res.end();
    });
    await expect(openUpstream(`http://127.0.0.1:${port}/`, { userAgent: 'x', allowAddress: (ip) => ip === '127.0.0.1' }))
      .rejects.toBeInstanceOf(StreamRefusedError);
  });

  it('follows a few redirects, not endlessly', async () => {
    let port = 0;
    port = await serve((req, res) => {
      if (req.url === '/final') {
        res.writeHead(200, { 'Content-Type': 'audio/aac' });
        res.end('aac');
        return;
      }
      const n = Number(req.url?.slice(1) || 0);
      res.writeHead(302, { Location: n >= 2 ? `http://127.0.0.1:${port}/final` : `/${n + 1}` });
      res.end();
    });
    const up = await openUpstream(`http://127.0.0.1:${port}/0`, { userAgent: 'x', allowAddress: () => true });
    expect(up.status).toBe(200);
    up.close();
    await expect(openUpstream(`http://127.0.0.1:${port}/0`, { userAgent: 'x', allowAddress: () => true, maxRedirects: 1 }))
      .rejects.toThrow(/too many redirects/);
  });

  it('gives up on a station that never answers', async () => {
    const port = await serve(() => { /* never answers */ });
    await expect(openUpstream(`http://127.0.0.1:${port}/`, { userAgent: 'x', allowAddress: () => true, timeoutMs: 100 }))
      .rejects.toThrow(/no answer/);
  });
});

describe('audioContentType', () => {
  it('passes audio types on and refuses a web page', () => {
    expect(audioContentType('audio/mpeg')).toBe('audio/mpeg');
    expect(audioContentType('audio/aacp; charset=x')).toBe('audio/aacp');
    expect(audioContentType('application/ogg')).toBe('application/ogg');
    expect(audioContentType('text/html; charset=utf-8')).toBeNull();
  });

  it('names an unlabelled stream by its codec', () => {
    expect(audioContentType(undefined, 'AAC+')).toBe('audio/aac');
    expect(audioContentType('application/octet-stream', 'MP3')).toBe('audio/mpeg');
    expect(audioContentType('', 'OGG')).toBe('audio/ogg');
  });
});

describe('createStreamSlots', () => {
  it('ends a member\'s oldest stream past their cap', () => {
    const slots = createStreamSlots(2, 10);
    const closed: string[] = [];
    slots.acquire('u1', () => closed.push('a'));
    slots.acquire('u1', () => closed.push('b'));
    slots.acquire('u1', () => closed.push('c'));
    expect(closed).toEqual(['a']);
    expect(slots.count('u1')).toBe(2);
  });

  it('refuses a new stream when the host is at its total, and frees a slot once', () => {
    const slots = createStreamSlots(2, 2);
    const a = slots.acquire('u1', () => {})!;
    slots.acquire('u2', () => {});
    expect(slots.acquire('u3', () => {})).toBeNull();
    a.release();
    a.release();
    expect(slots.count()).toBe(1);
    expect(slots.acquire('u3', () => {})).not.toBeNull();
  });
});
