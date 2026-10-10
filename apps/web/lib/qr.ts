/** A small QR code encoder: byte mode, error correction level M (or H, for a
 *  code with a logo over its middle), versions 1 to 10 (up to 213 bytes at
 *  M, plenty for a join link; 119 at H). No dependencies, no
 *  React: `encodeQr` returns the module grid and `qrSvgPath` turns it into
 *  one SVG path. Follows ISO/IEC 18004; tests/qr vectors come from the spec
 *  and from a reference encoder (lib/qr.test.ts). */

/** M recovers about 15% of the symbol, H about 30%: enough to cover the
 *  middle with a logo and still read. */
export type QrEcLevel = 'M' | 'H';

export interface QrCode {
  version: number;
  ecLevel: QrEcLevel;
  /** The mask pattern used (0 to 7). */
  mask: number;
  /** Modules per side: 17 + 4 * version. */
  size: number;
  /** modules[row][col], true = dark. */
  modules: boolean[][];
}

type BlockLayout = ReadonlyArray<{ ec: number; groups: ReadonlyArray<readonly [number, number]> }>;

/** Level M block layout per version: EC codewords per block, then
 *  [block count, data codewords per block] for each group. */
const BLOCKS_M: BlockLayout = [
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
];

/** Level H, the same shape (ISO/IEC 18004 table 9). */
const BLOCKS_H: BlockLayout = [
  { ec: 17, groups: [[1, 9]] },
  { ec: 28, groups: [[1, 16]] },
  { ec: 22, groups: [[2, 13]] },
  { ec: 16, groups: [[4, 9]] },
  { ec: 22, groups: [[2, 11], [2, 12]] },
  { ec: 28, groups: [[4, 15]] },
  { ec: 26, groups: [[4, 13], [1, 14]] },
  { ec: 26, groups: [[4, 14], [2, 15]] },
  { ec: 24, groups: [[4, 12], [4, 13]] },
  { ec: 28, groups: [[6, 15], [2, 16]] },
];

const BLOCKS: Record<QrEcLevel, BlockLayout> = { M: BLOCKS_M, H: BLOCKS_H };
/** The two format bits that name the level (M is 00, H is 10). */
const LEVEL_BITS: Record<QrEcLevel, number> = { M: 0b00, H: 0b10 };

const ALIGNMENT: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

export const QR_MAX_VERSION = BLOCKS_M.length;

function dataCodewords(version: number, level: QrEcLevel): number {
  return BLOCKS[level][version - 1].groups.reduce((n, [blocks, words]) => n + blocks * words, 0);
}

/** Most bytes one version holds at a level (M unless asked) in byte mode. */
export function qrCapacity(version: number, level: QrEcLevel = 'M'): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8);
}

// ---------- GF(256) and Reed-Solomon ----------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial of the given degree, highest coefficient first
 *  (the leading 1 left out). */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** The `ecCount` error correction codewords for one block of data. */
export function reedSolomon(data: readonly number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const rem = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < ecCount; i++) rem[i] ^= mul(gen[i], factor);
  }
  return rem;
}

// ---------- Format and version information ----------

/** The 15 format bits for a level (M unless asked) and a mask, BCH coded
 *  and masked. */
export function formatBits(mask: number, level: QrEcLevel = 'M'): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---------- Data ----------

function encodeData(bytes: Uint8Array, version: number, level: QrEcLevel): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version, level) * 8;
  put(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    words.push(w);
  }
  for (let pad = 0; words.length < capacity / 8; pad++) words.push(pad % 2 ? 0x11 : 0xec);
  return words;
}

/** Data and EC codewords split into blocks and interleaved. */
function interleave(data: number[], version: number, level: QrEcLevel): number[] {
  const { ec, groups } = BLOCKS[level][version - 1];
  const blocks: number[][] = [];
  let at = 0;
  for (const [count, words] of groups) {
    for (let b = 0; b < count; b++) {
      blocks.push(data.slice(at, at + words));
      at += words;
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  const ecBlocks = blocks.map((b) => reedSolomon(b, ec));
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

// ---------- The grid ----------

const MASKS: ReadonlyArray<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

interface Grid {
  size: number;
  dark: boolean[][];
  /** Function patterns: never masked, never data. */
  fixed: boolean[][];
}

function newGrid(size: number): Grid {
  const make = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, dark: make(), fixed: make() };
}

function set(g: Grid, r: number, c: number, dark: boolean) {
  g.dark[r][c] = dark;
  g.fixed[r][c] = true;
}

function drawFunctionPatterns(g: Grid, version: number, level: QrEcLevel) {
  const { size } = g;
  // Finders with their light separators.
  for (const [fr, fc] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = fr + dr;
        const c = fc + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(g, r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }
  // Alignment patterns, skipping the three that would overlap a finder.
  const pos = ALIGNMENT[version - 1];
  const last = pos.length - 1;
  pos.forEach((r, i) =>
    pos.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }),
  );
  // Reserve the format areas (written for real once the mask is known) and
  // the always-dark module.
  drawFormat(g, 0, level);
  set(g, size - 8, 8, true);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(g, a, b, dark);
      set(g, b, a, dark);
    }
  }
}

function drawFormat(g: Grid, mask: number, level: QrEcLevel) {
  const { size } = g;
  const bits = formatBits(mask, level);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // Around the top-left finder.
  for (let i = 0; i <= 5; i++) set(g, i, 8, bit(i));
  set(g, 7, 8, bit(6));
  set(g, 8, 8, bit(7));
  set(g, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(g, 8, 14 - i, bit(i));
  // Split between the other two finders.
  for (let i = 0; i < 8; i++) set(g, 8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(g, size - 15 + i, 8, bit(i));
  set(g, size - 8, 8, true);
}

function placeData(g: Grid, codewords: number[]) {
  const { size } = g;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - v : v;
        if (g.fixed[r][c]) continue;
        // Remainder bits past the last codeword stay light.
        g.dark[r][c] = bit < total && ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }
}

function applyMask(g: Grid, mask: number) {
  const fn = MASKS[mask];
  for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) if (!g.fixed[r][c] && fn(r, c)) g.dark[r][c] = !g.dark[r][c];
}

/** The spec's penalty score (lower is better) for choosing a mask. */
export function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let score = 0;
  const at = (r: number, c: number, byRow: boolean) => (byRow ? dark[r][c] : dark[c][r]);
  for (const byRow of [true, false]) {
    for (let r = 0; r < size; r++) {
      // Rule 1: runs of five or more of one colour.
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (at(r, c, byRow) === at(r, c - 1, byRow)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
      // Rule 3: a finder-like 1:1:3:1:1 with four light modules on a side.
      for (let c = 0; c + 10 < size; c++) {
        const s = Array.from({ length: 11 }, (_, k) => at(r, c + k, byRow));
        const core = s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6];
        const coreB = s[4] && !s[5] && s[6] && s[7] && s[8] && !s[9] && s[10];
        if (core && !s[7] && !s[8] && !s[9] && !s[10]) score += 40;
        if (coreB && !s[0] && !s[1] && !s[2] && !s[3]) score += 40;
      }
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const v = dark[r][c];
      if (dark[r][c + 1] === v && dark[r + 1][c] === v && dark[r + 1][c + 1] === v) score += 3;
    }
  }
  // Rule 4: how far the dark share is from half.
  let darkCount = 0;
  for (const row of dark) for (const m of row) if (m) darkCount++;
  const percent = (darkCount * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

export class QrTooLongError extends Error {
  constructor(bytes: number, level: QrEcLevel = 'M') {
    super(`Too long for a QR code here: ${bytes} bytes (at most ${qrCapacity(QR_MAX_VERSION, level)} at level ${level}).`);
  }
}

/** Encodes `text` (as UTF-8) in the smallest version that fits, at level M
 *  unless `ecLevel` says H. `mask` forces a mask pattern; otherwise the
 *  lowest-penalty one is used. */
export function encodeQr(
  text: string,
  opts: { mask?: number; minVersion?: number; ecLevel?: QrEcLevel } = {},
): QrCode {
  const level = opts.ecLevel ?? 'M';
  const bytes = new TextEncoder().encode(text);
  let version = Math.max(1, opts.minVersion ?? 1);
  while (version <= QR_MAX_VERSION && qrCapacity(version, level) < bytes.length) version++;
  if (version > QR_MAX_VERSION) throw new QrTooLongError(bytes.length, level);

  const codewords = interleave(encodeData(bytes, version, level), version, level);
  const size = 17 + 4 * version;
  const base = newGrid(size);
  drawFunctionPatterns(base, version, level);
  placeData(base, codewords);

  const build = (mask: number) => {
    const g: Grid = { size, dark: base.dark.map((r) => [...r]), fixed: base.fixed };
    applyMask(g, mask);
    drawFormat(g, mask, level);
    return g.dark;
  };

  if (opts.mask !== undefined) {
    if (!Number.isInteger(opts.mask) || opts.mask < 0 || opts.mask > 7) throw new RangeError('mask must be 0 to 7');
    return { version, ecLevel: level, mask: opts.mask, size, modules: build(opts.mask) };
  }
  let best = { mask: 0, modules: build(0), score: Infinity };
  for (let mask = 0; mask < 8; mask++) {
    const modules = mask === 0 ? best.modules : build(mask);
    const score = penalty(modules);
    if (score < best.score) best = { mask, modules, score };
  }
  return { version, ecLevel: level, mask: best.mask, size, modules: best.modules };
}

/** The square in the middle of a level H code that a logo may cover: an
 *  odd number of modules, about a fifth of the side (some 4% of the area,
 *  against the 30% level H recovers), centred. In module coordinates. */
export function qrLogoArea(qr: QrCode): { start: number; span: number } {
  const span = Math.round(qr.size * 0.2) | 1;
  return { start: (qr.size - span) / 2, span };
}

/** One SVG path (`d`) drawing every dark module as a unit square, each row's
 *  runs merged; place it in a viewBox of `0 0 size size` (plus a quiet zone).
 *  `clear` leaves a square of modules light (where a logo goes). */
export function qrSvgPath(qr: QrCode, opts: { clear?: { start: number; span: number } } = {}): string {
  const { clear } = opts;
  const inClear = (r: number, c: number) =>
    !!clear && r >= clear.start && r < clear.start + clear.span && c >= clear.start && c < clear.start + clear.span;
  const parts: string[] = [];
  qr.modules.forEach((row, r) => {
    let c = 0;
    while (c < qr.size) {
      if (!row[c] || inClear(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && row[c] && !inClear(r, c)) c++;
      parts.push(`M${start} ${r}h${c - start}v1h${start - c}z`);
    }
  });
  return parts.join('');
}
