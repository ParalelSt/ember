/** writeStreamToOpfs against the in-memory file system: a write that fails
 *  part way (a full disk) or an abort must also cancel the source, which is
 *  the body of a song download. Left unread, that response kept its
 *  connection to the server open after the download had already given up,
 *  one per song a full disk turned away. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asHandle, FakeDir } from '@/test-utils/fakeOpfs';
import { opfsWritable, writeStreamToOpfs } from './opfs';

function source() {
  const cancel = vi.fn();
  let n = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (n++ < 3) c.enqueue(new Uint8Array(4).fill(1));
      else c.close();
    },
    cancel,
  });
  return { stream, cancel };
}

describe('writeStreamToOpfs', () => {
  it('writes every chunk and reports the bytes', async () => {
    const dir = new FakeDir();
    const { stream, cancel } = source();
    expect(await writeStreamToOpfs(asHandle(dir), 'a.bin', stream)).toBe(12);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels the source when a write fails, and still throws', async () => {
    const dir = new FakeDir();
    dir.failWrites = true;
    const { stream, cancel } = source();
    await expect(writeStreamToOpfs(asHandle(dir), 'a.bin', stream)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the source when the file cannot even be opened', async () => {
    const dir = new FakeDir();
    dir.getFileHandle = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const { stream, cancel } = source();
    await expect(writeStreamToOpfs(asHandle(dir), 'a.bin', stream)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the source when the download is aborted', async () => {
    const dir = new FakeDir();
    const ac = new AbortController();
    ac.abort();
    const { stream, cancel } = source();
    await expect(writeStreamToOpfs(asHandle(dir), 'a.bin', stream, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('opfsWritable', () => {
  const storage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  afterEach(() => {
    vi.unstubAllGlobals();
    if (storage) Object.defineProperty(navigator, 'storage', storage);
    else delete (navigator as { storage?: unknown }).storage;
  });
  const withStorage = () =>
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: vi.fn() } });

  it('is false on Safari before 26 (iPhone app on iOS 17 and 18): a directory, but no way to write a file', () => {
    withStorage();
    vi.stubGlobal('FileSystemFileHandle', class {});
    expect(opfsWritable()).toBe(false);
  });

  it('is true where file handles can be written', () => {
    withStorage();
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
    expect(opfsWritable()).toBe(true);
  });

  it('is false with no storage API at all', () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
    expect(opfsWritable()).toBe(false);
  });
});
