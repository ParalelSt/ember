import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The fixtures are shared with tests/uploads-ui.test.mjs so both exercise the
// same tag bytes. They are built in code rather than checked in as binaries.
import {
  makeFlacWithPicture,
  makeM4aWithCovr,
  makeM4aWithoutCovr,
  makeMp3WithApic,
  makeMp3WithoutPicture,
  tinyJpeg,
  tinyPng,
} from '../../../../tests/fixtures/embedded-cover.mjs';

// MUSIC_DIR is read at module load in lib/uploads, so it has to be set before
// the module under test is imported.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-test-'));
process.env.MUSIC_DIR = musicDir;

const { MAX_COVER_BYTES, coverExtFor, coverFilename, deleteUploadCover, extractCover, saveUploadCover } = await import(
  '@/lib/uploads/cover'
);
const { UPLOAD_DIR } = await import('@/lib/uploads');

beforeEach(() => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('coverExtFor', () => {
  it('maps the JPEG spellings tags use to .jpg', () => {
    expect(coverExtFor('image/jpeg')).toBe('jpg');
    expect(coverExtFor('image/jpg')).toBe('jpg');
    expect(coverExtFor('JPG')).toBe('jpg');
  });

  it('maps PNG to .png', () => {
    expect(coverExtFor('image/png')).toBe('png');
    expect(coverExtFor('PNG')).toBe('png');
  });

  it('rejects formats we do not keep, and nothing at all', () => {
    expect(coverExtFor('image/gif')).toBeNull();
    expect(coverExtFor('image/webp')).toBeNull();
    expect(coverExtFor('')).toBeNull();
    expect(coverExtFor(undefined)).toBeNull();
  });
});

describe('extractCover', () => {
  it('reads an ID3v2 APIC picture out of an MP3', async () => {
    const cover = await extractCover(makeMp3WithApic());
    expect(cover?.ext).toBe('jpg');
    expect(cover?.data.equals(tinyJpeg())).toBe(true);
  });

  it('reads an iTunes covr atom out of an M4A', async () => {
    const cover = await extractCover(makeM4aWithCovr());
    expect(cover?.ext).toBe('png');
    expect(cover?.data.equals(tinyPng())).toBe(true);
  });

  it('reads a FLAC PICTURE block', async () => {
    const cover = await extractCover(makeFlacWithPicture());
    expect(cover?.ext).toBe('png');
    expect(cover?.data.equals(tinyPng())).toBe(true);
  });

  it('returns null for files that carry no picture', async () => {
    expect(await extractCover(makeMp3WithoutPicture())).toBeNull();
    expect(await extractCover(makeM4aWithoutCovr())).toBeNull();
  });

  it('sniffs the container itself rather than trusting any declared type', async () => {
    // A browser that reports audio/mp4 for an MP3 must not cost us the cover,
    // which is why no content type is passed in at all.
    const mp3 = makeMp3WithApic();
    expect((await extractCover(mp3))?.ext).toBe('jpg');
    expect((await extractCover(makeM4aWithCovr()))?.ext).toBe('png');
  });

  it('ignores a picture over the size cap', async () => {
    const huge = Buffer.alloc(MAX_COVER_BYTES + 1, 0x41);
    expect(await extractCover(makeMp3WithApic({ image: huge, mime: 'image/jpeg' }))).toBeNull();
  });

  it('ignores a picture in a format we do not keep', async () => {
    const cover = await extractCover(makeMp3WithApic({ image: tinyPng(), mime: 'image/gif' }));
    expect(cover).toBeNull();
  });

  it('returns null rather than throwing on bytes that are not audio at all', async () => {
    expect(await extractCover(Buffer.from('not audio, not even close'))).toBeNull();
  });
});

describe('saveUploadCover', () => {
  it('writes the cover as <id>.<ext> beside the audio and returns the extension', async () => {
    const ext = await saveUploadCover(makeMp3WithApic(), 'rec123');
    expect(ext).toBe('jpg');
    const written = fs.readFileSync(path.join(UPLOAD_DIR, 'rec123.jpg'));
    expect(written.equals(tinyJpeg())).toBe(true);
  });

  it('writes nothing and returns null when there is no cover', async () => {
    expect(await saveUploadCover(makeMp3WithoutPicture(), 'rec456')).toBeNull();
    expect(fs.readdirSync(UPLOAD_DIR)).toEqual([]);
  });

  it('returns null instead of throwing when the write fails', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));
    expect(await saveUploadCover(makeMp3WithApic(), 'rec789')).toBeNull();
  });

  it('refuses an id that would escape the uploads directory', async () => {
    expect(await saveUploadCover(makeMp3WithApic(), '../escape')).toBeNull();
  });
});

describe('deleteUploadCover', () => {
  it('removes the cover file for a recorded extension', async () => {
    await saveUploadCover(makeMp3WithApic(), 'gone1');
    await deleteUploadCover('gone1', 'jpg');
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'gone1.jpg'))).toBe(false);
  });

  it('does nothing for an upload with no recorded extension', async () => {
    await expect(deleteUploadCover('gone2', '')).resolves.toBeUndefined();
  });

  it('does not throw when the file is already gone', async () => {
    await expect(deleteUploadCover('never-existed', 'png')).resolves.toBeUndefined();
  });
});

describe('coverFilename', () => {
  it('keys the file by the record id', () => {
    expect(coverFilename('abc', 'jpg')).toBe('abc.jpg');
  });
});
