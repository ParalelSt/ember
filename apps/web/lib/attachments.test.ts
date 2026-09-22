import { describe, expect, it } from 'vitest';
import {
  attachmentProblem,
  formAttachments,
  formatBytes,
  isAllowedType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  safeAttachmentName,
  totalBytes,
} from './attachments';

const MB = 1024 * 1024;
const img = (size: number, name = 'shot.png') => ({ name, size, type: 'image/png' });
const vid = (size: number, name = 'clip.mp4') => ({ name, size, type: 'video/mp4' });

describe('attachments', () => {
  it('formats sizes the way the dialog shows them', () => {
    expect(formatBytes(1.25 * MB)).toBe('1.3 MB');
    expect(formatBytes(840 * 1024)).toBe('840 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });

  it('allows images and videos only', () => {
    expect(isAllowedType('image/png')).toBe(true);
    expect(isAllowedType('video/webm')).toBe(true);
    expect(isAllowedType('application/pdf')).toBe(false);
    expect(isAllowedType('')).toBe(false);
  });

  it('accepts up to the file and byte limits', () => {
    expect(attachmentProblem([])).toBeNull();
    expect(attachmentProblem([img(2 * MB), vid(7 * MB)])).toBeNull();
    const four = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => img(MB, `s${i}.png`));
    expect(attachmentProblem(four)).toBeNull();
    expect(attachmentProblem([vid(MAX_ATTACHMENT_BYTES)])).toBeNull();
  });

  it('says what is wrong, in one sentence', () => {
    const five = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => img(10, `s${i}.png`));
    expect(attachmentProblem(five)).toBe('Up to 4 files per message.');
    expect(attachmentProblem([{ name: 'notes.pdf', size: 10, type: 'application/pdf' }])).toBe(
      'notes.pdf is not an image or a video.',
    );
    expect(attachmentProblem([img(2 * MB), vid(37.6 * MB)])).toBe(
      'Files are 39.6 MB. Discord takes 10 MB per message: trim the clip or send fewer files.',
    );
    expect(totalBytes([img(1), vid(2)])).toBe(3);
  });
});

describe('safeAttachmentName', () => {
  it('keeps a plain name and its extension', () => {
    expect(safeAttachmentName('Screenshot_2026-09-22.png', 0)).toBe('Screenshot_2026-09-22.png');
  });

  it('drops any path and replaces unsafe characters', () => {
    expect(safeAttachmentName('../../etc/pass wd.png', 0)).toBe('pass_wd.png');
    expect(safeAttachmentName('C:\\Users\\me\\Screen Shot (2).mov', 0)).toBe('Screen_Shot_2_.mov');
    expect(safeAttachmentName('clip<script>.mp4', 0)).toBe('clip_script_.mp4');
  });

  it('does not start with a dot and keeps the tail of a very long name', () => {
    expect(safeAttachmentName('.hidden.png', 0)).toBe('hidden.png');
    const long = safeAttachmentName(`${'a'.repeat(300)}.webm`, 0);
    expect(long.length).toBe(100);
    expect(long.endsWith('.webm')).toBe(true);
  });

  it('falls back to a numbered name when nothing usable is left', () => {
    expect(safeAttachmentName('', 2)).toBe('attachment-3');
    expect(safeAttachmentName('???', 0)).toBe('attachment-1');
  });
});

describe('formAttachments', () => {
  it('returns the file entries only', () => {
    const form = new FormData();
    form.append('attachments', new File(['x'], 'a.png', { type: 'image/png' }));
    form.append('attachments', 'not a file');
    form.append('other', new File(['y'], 'b.png', { type: 'image/png' }));
    expect(formAttachments(form).map((f) => f.name)).toEqual(['a.png']);
  });
});
