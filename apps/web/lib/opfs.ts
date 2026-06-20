'use client';

/** Thin wrapper over the Origin Private File System.
 *  Centralizes the handful of operations the offline-playback feature uses
 *  so the orchestrator and service worker can share the same vocabulary.
 *  Async-only — sync access handles are available in workers but not worth
 *  the Safari risk surface for our scale.
 *
 *  Several casts below paper over gaps in TS's stdlib types: `dir.entries()`
 *  iteration, `FileSystemFileHandle.move()` (atomic rename), and Uint8Array
 *  generic narrowing all work in modern browsers but aren't yet in lib.dom. */

type MovableFileHandle = FileSystemFileHandle & { move: (newName: string) => Promise<void> };
type IterableDirHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export async function ensureDir(
  root: FileSystemDirectoryHandle,
  path: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of path) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

export async function getDirIfExists(
  root: FileSystemDirectoryHandle,
  path: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let dir: FileSystemDirectoryHandle = root;
  for (const segment of path) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create: false });
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return null;
      throw e;
    }
  }
  return dir;
}

export async function writeStreamToOpfs(
  dir: FileSystemDirectoryHandle,
  filename: string,
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  let bytes = 0;
  try {
    const reader = source.getReader();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value as BufferSource);
      bytes += value.byteLength;
    }
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
  return bytes;
}

export async function readBlob(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<File | null> {
  try {
    const handle = await dir.getFileHandle(filename, { create: false });
    return await handle.getFile();
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') return null;
    throw e;
  }
}

/** Atomic JSON write: write to `<name>.tmp`, then rename to `<name>`. */
export async function atomicWriteJson(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: unknown,
): Promise<void> {
  const tmpName = `${filename}.tmp`;
  const handle = await dir.getFileHandle(tmpName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data));
  await writable.close();
  await (handle as MovableFileHandle).move(filename);
}

export async function readJson<T>(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<T | null> {
  const file = await readBlob(dir, filename);
  if (!file) return null;
  try {
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

export async function deleteEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  try {
    await dir.removeEntry(name, options);
  } catch (e) {
    if ((e as DOMException).name !== 'NotFoundError') throw e;
  }
}

export async function listEntries(
  dir: FileSystemDirectoryHandle,
): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
  const out: Array<{ name: string; kind: 'file' | 'directory' }> = [];
  for await (const [name, handle] of (dir as IterableDirHandle).entries()) {
    out.push({ name, kind: handle.kind });
  }
  return out;
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
