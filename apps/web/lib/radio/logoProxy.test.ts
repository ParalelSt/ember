// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { acceptableLogoType, fetchLogo, LogoRefusedError, sniffImageType } from './logoProxy';
import { StreamRefusedError } from './streamProxy';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

describe('sniffImageType', () => {
  it.each([
    [PNG, 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'image/jpeg'],
    [Buffer.from('GIF89a....'), 'image/gif'],
    [Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    [Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]), 'image/x-icon'],
    [Buffer.concat([Buffer.from('\0\0\0\x1cftypavif'), Buffer.alloc(8)]), 'image/avif'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), null],
    [Buffer.from('<!doctype html><html>'), null],
    [Buffer.alloc(0), null],
  ])('%#', (bytes, type) => {
    expect(sniffImageType(bytes)).toBe(type);
  });
});

describe('acceptableLogoType', () => {
  it('takes images other than SVG, and untyped answers', () => {
    expect(acceptableLogoType('image/png')).toBe(true);
    expect(acceptableLogoType('image/x-icon; charset=binary')).toBe(true);
    expect(acceptableLogoType('application/octet-stream')).toBe(true);
    expect(acceptableLogoType(undefined)).toBe(true);
    expect(acceptableLogoType('image/svg+xml')).toBe(false);
    expect(acceptableLogoType('text/html')).toBe(false);
  });
});

describe('fetchLogo', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
  });
  async function serve(handler: http.RequestListener): Promise<string> {
    const s = http.createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }
  const allowAddress = () => true;

  it('fetches a logo, typed by its bytes rather than by what the site said', async () => {
    const base = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(PNG); });
    const logo = await fetchLogo(`${base}/favicon.ico`, { userAgent: 'Ember/test', allowAddress });
    expect(logo.type).toBe('image/png');
    expect(logo.bytes.equals(PNG)).toBe(true);
  });

  it('refuses this host and its network', async () => {
    const base = await serve((_q, res) => res.end(PNG));
    await expect(fetchLogo(`${base}/x.png`, { userAgent: 'Ember/test' })).rejects.toBeInstanceOf(StreamRefusedError);
  });

  it('refuses SVG, HTML and bytes that are no raster image', async () => {
    const svg = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg/>'); });
    await expect(fetchLogo(svg, { userAgent: 'x', allowAddress })).rejects.toBeInstanceOf(LogoRefusedError);
    const html = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); });
    await expect(fetchLogo(html, { userAgent: 'x', allowAddress })).rejects.toBeInstanceOf(LogoRefusedError);
    const lying = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('<script>alert(1)</script>'); });
    await expect(fetchLogo(lying, { userAgent: 'x', allowAddress })).rejects.toThrow('not a raster image');
  });

  it('refuses an error answer', async () => {
    const base = await serve((_q, res) => { res.writeHead(404, { 'Content-Type': 'image/png' }); res.end(PNG); });
    await expect(fetchLogo(base, { userAgent: 'x', allowAddress })).rejects.toThrow('404');
  });

  it('refuses a logo past the size cap, declared or streamed', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2_000)]);
    const declared = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': big.length }); res.end(big); });
    await expect(fetchLogo(declared, { userAgent: 'x', allowAddress, maxBytes: 1_000 })).rejects.toThrow('too big');
    const chunked = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(big.subarray(0, 900)); res.end(big.subarray(900)); });
    await expect(fetchLogo(chunked, { userAgent: 'x', allowAddress, maxBytes: 1_000 })).rejects.toThrow('too big');
  });

  it('gives up on a logo that takes too long', async () => {
    const slow = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(PNG.subarray(0, 4)); });
    await expect(fetchLogo(slow, { userAgent: 'x', allowAddress, timeoutMs: 150 })).rejects.toThrow('took too long');
  });
});
