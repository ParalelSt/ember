import { describe, expect, it } from 'vitest';
import {
  attachmentProblem,
  formatBytes,
  isAllowedType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
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
