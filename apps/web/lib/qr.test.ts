import { describe, expect, it } from 'vitest';
import { encodeQr, formatBits, penalty, qrCapacity, qrLogoArea, qrSvgPath, QrTooLongError, reedSolomon, versionBits } from './qr';
import { QR_VECTORS } from './qr.vectors';

const hex = (s: string) => s.split(' ').map((h) => parseInt(h, 16));
const rows = (m: boolean[][]) => m.map((r) => r.map((b) => (b ? '1' : '0')).join(''));

describe('Reed-Solomon (spec and textbook vectors)', () => {
  it('ISO/IEC 18004 Annex I: "01234567" as 1-M', () => {
    const data = hex('10 20 0C 56 61 80 EC 11 EC 11 EC 11 EC 11 EC 11');
    expect(reedSolomon(data, 10)).toEqual(hex('A5 24 D4 C1 ED 36 C7 87 2C 55'));
  });

  it('"HELLO WORLD" as 1-M', () => {
    const data = hex('20 5B 0B 78 D1 72 DC 4D 43 40 EC 11 EC 11 EC 11');
    expect(reedSolomon(data, 10)).toEqual(hex('C4 23 27 77 EB D7 E7 E2 5D 17'));
  });
});

describe('format and version information', () => {
  it('level M, every mask (the spec table)', () => {
    const table = [
      '101010000010010',
      '101000100100101',
      '101111001111100',
      '101101101001011',
      '100010111111001',
      '100000011001110',
      '100111110010111',
      '100101010100000',
    ];
    table.forEach((bits, mask) => expect(formatBits(mask).toString(2).padStart(15, '0')).toBe(bits));
  });

  it('level H, every mask (the spec table)', () => {
    const table = [
      '001011010001001',
      '001001110111110',
      '001110011100111',
      '001100111010000',
      '000011101100010',
      '000001001010101',
      '000110100001100',
      '000100000111011',
    ];
    table.forEach((bits, mask) => expect(formatBits(mask, 'H').toString(2).padStart(15, '0')).toBe(bits));
  });

  it('version 7 and 10 (the spec table)', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
    expect(versionBits(10).toString(2).padStart(18, '0')).toBe('001010010011010011');
  });
});

describe('encodeQr', () => {
  it('capacity per version at level M, byte mode', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => qrCapacity(v))).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  });

  it('capacity per version at level H, byte mode (the spec table)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => qrCapacity(v, 'H'))).toEqual([7, 14, 24, 34, 44, 58, 64, 84, 98, 119]);
  });

  it('level H: a sign-in link fits, says its level, and too long throws', () => {
    const link = `https://ember.example.com/link/${'A'.repeat(43)}`;
    const qr = encodeQr(link, { ecLevel: 'H' });
    expect(qr.ecLevel).toBe('H');
    expect(qr.version).toBe(8);
    expect(encodeQr(link).ecLevel).toBe('M');
    expect(() => encodeQr('x'.repeat(120), { ecLevel: 'H' })).toThrow(QrTooLongError);
  });

  it('the logo area is an odd, centred square of about a fifth of the side', () => {
    for (const v of [1, 5, 8, 10]) {
      const qr = encodeQr('x', { minVersion: v, ecLevel: 'H' });
      const { start, span } = qrLogoArea(qr);
      expect(span % 2).toBe(1);
      expect(start * 2 + span).toBe(qr.size);
      expect(span / qr.size).toBeGreaterThan(0.15);
      expect(span / qr.size).toBeLessThan(0.25);
    }
  });

  it('qrSvgPath leaves the cleared square light', () => {
    const qr = encodeQr('x', { minVersion: 3, ecLevel: 'H' });
    const area = qrLogoArea(qr);
    const d = qrSvgPath(qr, { clear: area });
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const [x, y, n] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const rowInside = y >= area.start && y < area.start + area.span;
      const overlaps = x < area.start + area.span && x + n > area.start;
      expect(rowInside && overlaps).toBe(false);
    }
  });

  it.each(QR_VECTORS.map((v) => [v.text.slice(0, 24), v] as const))('matches the reference symbol: %s', (_label, v) => {
    const qr = encodeQr(v.text, { mask: v.mask });
    expect(qr.version).toBe(v.version);
    expect(qr.size).toBe(17 + 4 * v.version);
    expect(rows(qr.modules)).toEqual(v.rows);
  });

  it('picks the smallest version that fits', () => {
    expect(encodeQr('x'.repeat(14)).version).toBe(1);
    expect(encodeQr('x'.repeat(15)).version).toBe(2);
    expect(encodeQr('x'.repeat(213)).version).toBe(10);
  });

  it('a join link fits comfortably', () => {
    const qr = encodeQr('https://ember.example.com/session/join/K7MPQ4');
    expect(qr.version).toBeLessThanOrEqual(4);
  });

  it('chooses the mask with the lowest penalty', () => {
    const text = 'https://ember.example/session/join/K7MPQ4';
    const auto = encodeQr(text);
    const scores = Array.from({ length: 8 }, (_, m) => penalty(encodeQr(text, { mask: m }).modules));
    expect(scores[auto.mask]).toBe(Math.min(...scores));
    expect(rows(auto.modules)).toEqual(rows(encodeQr(text, { mask: auto.mask }).modules));
  });

  it('refuses text past version 10, and a bad mask', () => {
    expect(() => encodeQr('x'.repeat(214))).toThrow(QrTooLongError);
    expect(() => encodeQr('A', { mask: 8 })).toThrow(RangeError);
  });
});

describe('penalty', () => {
  it('scores runs, blocks and balance as the spec does', () => {
    // 5x5 all dark: rule 1 is 3 per row and per column (10 lines), rule 2 is
    // 3 per 2x2 block (16), rule 4 is 100% dark: 10 steps of 5% = 100.
    const allDark = Array.from({ length: 5 }, () => new Array(5).fill(true));
    expect(penalty(allDark)).toBe(10 * 3 + 16 * 3 + 100);
  });

  it('counts a finder-like pattern next to four light modules', () => {
    const line = '10111010000'.split('').map((c) => c === '1');
    const grid = Array.from({ length: 11 }, (_, r) => (r === 0 ? line : new Array(11).fill(r % 2 === 0)));
    const withPattern = penalty(grid);
    const broken = penalty(grid.map((r, i) => (i === 0 ? [...r.slice(0, 7), true, ...r.slice(8)] : r)));
    expect(withPattern - broken).toBeGreaterThanOrEqual(40 - 3);
  });
});

describe('qrSvgPath', () => {
  it('draws each run of dark modules as one rectangle', () => {
    const qr = { version: 1, ecLevel: 'M' as const, mask: 0, size: 3, modules: [[true, true, false], [false, false, false], [true, false, true]] };
    expect(qrSvgPath(qr)).toBe('M0 0h2v1h-2zM0 2h1v1h-1zM2 2h1v1h-1z');
  });
});
