/** A small in-memory Origin Private File System for tests: directories,
 *  files with a writable stream, `move` (optional, to test the copy
 *  fallback), `removeEntry` and `entries()`. Test-only. */

type Node = FakeDir | FakeFile;

export class FakeFile {
  kind = 'file' as const;
  data: Uint8Array = new Uint8Array();
  constructor(public name: string, public parent: FakeDir) {}
  async getFile() {
    return new File([this.data as BlobPart], this.name);
  }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array | string) => {
        if (this.parent.failWrites) throw new DOMException('quota', 'QuotaExceededError');
        chunks.push(typeof c === 'string' ? new TextEncoder().encode(c) : c);
      },
      close: async () => {
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.byteLength; }
        this.data = out;
      },
      abort: async () => {},
    };
  }
  async move(name: string) {
    this.parent.children.delete(this.name);
    this.name = name;
    this.parent.children.set(name, this);
  }
}

export class FakeDir {
  kind = 'directory' as const;
  children = new Map<string, Node>();
  /** Make every write in this directory fail (a full disk). */
  failWrites = false;
  async getDirectoryHandle(name: string, o: { create?: boolean } = {}) {
    let d = this.children.get(name);
    if (!d && o.create) { d = new FakeDir(); this.children.set(name, d); }
    if (!(d instanceof FakeDir)) throw new DOMException('missing', 'NotFoundError');
    return d;
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    let f = this.children.get(name);
    if (!f && o.create) { f = new FakeFile(name, this); this.children.set(name, f); }
    if (!(f instanceof FakeFile)) throw new DOMException('missing', 'NotFoundError');
    return f;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async *entries() {
    yield* this.children.entries();
  }
  /** Test helper: the file names directly in this directory. */
  names(): string[] {
    return [...this.children.keys()].sort();
  }
  /** Test helper: walk a path of directory names. */
  dir(...path: string[]): FakeDir {
    if (path.length === 0) return this;
    const [first, ...rest] = path;
    const next = this.children.get(first);
    if (!(next instanceof FakeDir)) throw new Error(`no directory ${first}`);
    return next.dir(...rest);
  }
  /** Test helper: put a file with these bytes here. */
  put(name: string, bytes: Uint8Array | string) {
    const f = new FakeFile(name, this);
    f.data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    this.children.set(name, f);
    return f;
  }
}

export function asHandle(d: FakeDir): FileSystemDirectoryHandle {
  return d as unknown as FileSystemDirectoryHandle;
}
