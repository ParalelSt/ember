// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn, error: vi.fn(), info: vi.fn() } }));

import {
  isBackupBusy,
  isLowDisk,
  isValidBackupName,
  LOW_DISK_MIN_BYTES,
  memberFiles,
  memberFilesArchive,
  memberFilesArchiveName,
  memberFilesSummary,
  tarHeader,
} from './backups';

describe('isValidBackupName', () => {
  it('accepts the names PocketBase gives backups', () => {
    expect(isValidBackupName('pb_backup_acme_20260926083419.zip')).toBe(true);
    expect(isValidBackupName('@auto_pb_backup_ember_20260926040000.zip')).toBe(true);
    expect(isValidBackupName('my-copy.v2.zip')).toBe(true);
  });

  it('refuses anything that could leave the backups folder or is not a zip', () => {
    for (const bad of [
      '../data.db',
      '..%2Fdata.db',
      '../../etc/passwd.zip',
      'a/../b.zip',
      'sub/b.zip',
      'sub\\b.zip',
      '..zip',
      'a..b.zip',
      '.zip',
      '.hidden.zip',
      'data.db',
      'backup.zip.attrs',
      '%2e%2e.zip',
      'back up.zip',
      '',
      `${'a'.repeat(200)}.zip`,
      'x.zip\0.txt',
    ]) {
      expect(isValidBackupName(bad), bad).toBe(false);
    }
  });
});

describe('isBackupBusy', () => {
  it('is true only for PocketBase saying another backup is running', () => {
    const busy = 'Try again later - another backup/restore process has already been started.';
    expect(isBackupBusy({ status: 400, message: busy, response: { message: busy } })).toBe(true);
    expect(isBackupBusy({ status: 400, message: 'Failed to create backup.' })).toBe(false);
    expect(isBackupBusy({ status: 500, message: busy })).toBe(false);
    expect(isBackupBusy(null)).toBe(false);
  });
});

describe('isLowDisk', () => {
  it('warns under the fixed floor even with small backups', () => {
    expect(isLowDisk(LOW_DISK_MIN_BYTES - 1, 1000)).toBe(true);
    expect(isLowDisk(LOW_DISK_MIN_BYTES + 1, 1000)).toBe(false);
  });

  it('warns under three times the largest backup', () => {
    const big = 2 * LOW_DISK_MIN_BYTES;
    expect(isLowDisk(3 * big - 1, big)).toBe(true);
    expect(isLowDisk(3 * big, big)).toBe(false);
  });
});

describe('tarHeader', () => {
  it('writes a valid ustar header with a correct checksum', () => {
    const h = tarHeader('ember-files/uploads/a.mp3', 1234, 1_700_000_000_000)!;
    expect(h.length).toBe(512);
    expect(h.subarray(0, 25).toString()).toBe('ember-files/uploads/a.mp3');
    expect(h.subarray(257, 262).toString()).toBe('ustar');
    expect(parseInt(h.subarray(124, 135).toString(), 8)).toBe(1234);
    const stored = parseInt(h.subarray(148, 154).toString(), 8);
    const copy = Buffer.from(h);
    copy.fill(0x20, 148, 156);
    expect(copy.reduce((n, b) => n + b, 0)).toBe(stored);
  });

  it('splits a long path into prefix and name', () => {
    const long = `ember-files/tabs/${'d'.repeat(90)}/${'f'.repeat(60)}.tex`;
    const h = tarHeader(long, 1, 0)!;
    const name = h.subarray(0, 100).toString().replace(/\0+$/, '');
    const prefix = h.subarray(345, 500).toString().replace(/\0+$/, '');
    expect(`${prefix}/${name}`).toBe(long);
  });

  it('gives up on a name that cannot fit', () => {
    expect(tarHeader(`ember-files/${'x'.repeat(300)}`, 1, 0)).toBeNull();
  });
});

describe('memberFilesArchiveName', () => {
  it('dates the archive', () => {
    expect(memberFilesArchiveName(new Date('2026-09-26T12:00:00Z'))).toBe('ember-files-2026-09-26.tar.gz');
  });
});

/** Reads a tar buffer back into name → content. */
function untar(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0[\s\S]*$/, '');
    const prefix = h.subarray(345, 500).toString().replace(/\0[\s\S]*$/, '');
    const size = parseInt(h.subarray(124, 135).toString(), 8);
    off += 512;
    out.set(prefix ? `${prefix}/${name}` : name, buf.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe('member files', () => {
  let root: string;
  let outside: string;
  const song = Buffer.alloc(70_000, 7); // spans several read chunks' worth of blocks

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-backups-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-outside-'));
    fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tabs', 'generated'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pranks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'uploads', 'u1.mp3'), song);
    fs.writeFileSync(path.join(root, 'uploads', 'u1.cover.jpg'), 'jpeg');
    fs.writeFileSync(path.join(root, 'tabs', 't1.gp5'), 'tab');
    fs.writeFileSync(path.join(root, 'tabs', 'generated', 'g1.tex'), '');
    fs.writeFileSync(path.join(root, 'pranks', 'quack.mp3'), 'quack');
    // Cached YouTube audio at the top level: re-downloadable, left out.
    fs.writeFileSync(path.join(root, 'dQw4w9WgXcQ.m4a'), 'cached');
    // A symlink pointing out of MUSIC_DIR must not be followed.
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'uploads', 'link.mp3'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('lists uploads, tabs and prank sounds only', async () => {
    const names = (await memberFiles(root)).map((f) => f.name).sort();
    expect(names).toEqual([
      'pranks/quack.mp3',
      'tabs/generated/g1.tex',
      'tabs/t1.gp5',
      'uploads/u1.cover.jpg',
      'uploads/u1.mp3',
    ]);
    expect(await memberFilesSummary(root)).toEqual({ files: 5, bytes: song.length + 4 + 3 + 0 + 5 });
  });

  it('is empty, not an error, when MUSIC_DIR has none of the folders', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-empty-'));
    try {
      expect(await memberFilesSummary(empty)).toEqual({ files: 0, bytes: 0 });
      const tar = zlib.gunzipSync(await readAll(await memberFilesArchive(empty)));
      expect(tar.length).toBe(1024);
      expect(untar(tar).size).toBe(0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('streams a gzipped tar with every file intact', async () => {
    const gz = await readAll(await memberFilesArchive(root));
    const files = untar(zlib.gunzipSync(gz));
    expect([...files.keys()].sort()).toEqual([
      'ember-files/pranks/quack.mp3',
      'ember-files/tabs/generated/g1.tex',
      'ember-files/tabs/t1.gp5',
      'ember-files/uploads/u1.cover.jpg',
      'ember-files/uploads/u1.mp3',
    ]);
    expect(files.get('ember-files/uploads/u1.mp3')!.equals(song)).toBe(true);
    expect(files.get('ember-files/pranks/quack.mp3')!.toString()).toBe('quack');
  });

  it('leaves out a file it cannot open and logs it, instead of a zero-filled copy', async () => {
    if (process.getuid?.() === 0) return; // root reads anything
    const locked = path.join(root, 'uploads', 'locked.mp3');
    fs.writeFileSync(locked, 'private');
    fs.chmodSync(locked, 0o000);
    warn.mockClear();
    try {
      const files = untar(zlib.gunzipSync(await readAll(await memberFilesArchive(root))));
      expect(files.has('ember-files/uploads/locked.mp3')).toBe(false);
      expect(files.get('ember-files/uploads/u1.mp3')!.equals(song)).toBe(true);
      expect(warn).toHaveBeenCalledWith('backups', expect.stringContaining('uploads/locked.mp3'), expect.anything(), expect.anything());
    } finally {
      fs.chmodSync(locked, 0o644);
      fs.rmSync(locked);
    }
  });

  it('unpacks with the system tar', async () => {
    const hasTar = spawnSync('tar', ['--version']).status === 0;
    if (!hasTar) return;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-untar-'));
    try {
      const file = path.join(dest, 'files.tar.gz');
      fs.writeFileSync(file, await readAll(await memberFilesArchive(root)));
      const r = spawnSync('tar', ['-xzf', file, '-C', dest], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readFileSync(path.join(dest, 'ember-files', 'uploads', 'u1.mp3')).equals(song)).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'ember-files', 'tabs', 't1.gp5'), 'utf8')).toBe('tab');
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});
