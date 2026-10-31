import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentPicker } from './AttachmentPicker';

const MB = 1024 * 1024;

/** A File that reports `size` bytes without allocating them. */
function fakeFile(name: string, type: string, size = 1000): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function Harness({ initial = [], onFiles }: { initial?: File[]; onFiles?: (f: File[]) => void }) {
  const [files, setFiles] = useState<File[]>(initial);
  return (
    <AttachmentPicker
      files={files}
      onChange={(f) => {
        setFiles(f);
        onFiles?.(f);
      }}
    />
  );
}

const input = () => screen.getByTestId('attachment-input') as HTMLInputElement;
const thumbs = () => screen.queryAllByTestId('attach-thumb');

let created: string[];
let revoked: string[];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:test/${n++}`;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});

afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe('AttachmentPicker', () => {
  it('shows the plus tile and the hint with nothing attached', () => {
    render(<Harness />);
    const plus = screen.getByRole('button', { name: 'Attach screenshot or video' });
    expect(plus).toBeEnabled();
    expect(plus).toHaveTextContent('');
    expect(plus.className).toContain('bg-muted');
    expect(plus.className.split(' ')).not.toContain('border');
    expect(screen.getByText('Optional. Up to 4 images or clips, 10 MB in total.')).toBeInTheDocument();
    expect(input()).toHaveAttribute('accept', 'image/*,video/*');
    expect(input()).toHaveAttribute('multiple');
    expect(thumbs()).toHaveLength(0);
  });

  it('the plus tile opens the file picker, and is the size of a thumbnail, after them', async () => {
    render(<Harness initial={[fakeFile('a.png', 'image/png')]} />);
    const click = vi.spyOn(input(), 'click');
    const plus = screen.getByTestId('attach-add');
    fireEvent.click(plus);
    expect(click).toHaveBeenCalledTimes(1);
    expect(plus.className).toContain('size-14');
    expect(thumbs()[0].className).toContain('size-14');
    expect(thumbs()[0].compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds picked files as thumbnails and shows the total', async () => {
    render(<Harness />);
    await userEvent.upload(input(), [fakeFile('shot.png', 'image/png', 2 * MB), fakeFile('clip.mp4', 'video/mp4', MB)]);
    expect(thumbs().map((t) => t.dataset.kind)).toEqual(['image', 'video']);
    expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute('src', 'blob:test/0');
    expect(screen.getByLabelText('clip.mp4').tagName).toBe('VIDEO');
    expect(screen.getByTestId('attach-summary')).toHaveTextContent('2 of 4 · 3 MB of 10 MB');
  });

  it('appends to what is already attached', async () => {
    render(<Harness />);
    await userEvent.upload(input(), fakeFile('a.png', 'image/png'));
    await userEvent.upload(input(), fakeFile('b.png', 'image/png'));
    expect(thumbs()).toHaveLength(2);
  });

  it('shows the clip length once its metadata loads', async () => {
    render(<Harness />);
    await userEvent.upload(input(), fakeFile('clip.webm', 'video/webm'));
    const video = screen.getByLabelText('clip.webm') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 75.4 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByTestId('attach-duration')).toHaveTextContent('1:15');
  });

  it('caps at 4 files and the plus tile goes away there', async () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    await userEvent.upload(
      input(),
      ['1', '2', '3', '4', '5'].map((n) => fakeFile(`${n}.png`, 'image/png')),
    );
    expect(thumbs()).toHaveLength(4);
    expect(onFiles.mock.calls.at(-1)?.[0].map((f: File) => f.name)).toEqual(['1.png', '2.png', '3.png', '4.png']);
    expect(screen.queryByRole('button', { name: /Attach screenshot or video/ })).toBeNull();
    // Removing one brings it back.
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1.png' }));
    expect(screen.getByRole('button', { name: /Attach screenshot or video/ })).toBeEnabled();
  });

  it('removes a file and revokes its preview URL', async () => {
    render(<Harness />);
    await userEvent.upload(input(), [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(thumbs()).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'b.png' })).toBeInTheDocument();
    expect(revoked).toEqual(['blob:test/0']);
  });

  it('revokes every preview URL on unmount', async () => {
    const { unmount } = render(<Harness />);
    await userEvent.upload(input(), [fakeFile('a.png', 'image/png'), fakeFile('b.mp4', 'video/mp4')]);
    unmount();
    expect(revoked.sort()).toEqual([...created].sort());
    expect(created).toHaveLength(2);
  });

  it('says what is wrong when the files are too big', () => {
    render(<Harness initial={[fakeFile('long.mp4', 'video/mp4', 12 * MB)]} />);
    expect(screen.getByTestId('attach-problem')).toHaveTextContent(
      'Files are 12 MB. Discord takes 10 MB per message: trim the clip or send fewer files.',
    );
    expect(screen.queryByTestId('attach-summary')).toBeNull();
  });

  it('says what is wrong with a file that is not an image or video', () => {
    render(<Harness initial={[fakeFile('notes.pdf', 'application/pdf')]} />);
    expect(screen.getByTestId('attach-problem')).toHaveTextContent('notes.pdf is not an image or a video.');
  });
});
