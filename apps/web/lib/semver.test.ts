import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion } from './semver';

describe('parseVersion', () => {
  it('reads x.y.z with or without a v prefix', () => {
    expect(parseVersion('0.3.1')).toEqual([0, 3, 1]);
    expect(parseVersion('v1.20.3')).toEqual([1, 20, 3]);
    expect(parseVersion('  v2.0.0  ')).toEqual([2, 0, 0]);
  });

  it('turns malformed input into 0.0.0', () => {
    expect(parseVersion('')).toEqual([0, 0, 0]);
    expect(parseVersion('banana')).toEqual([0, 0, 0]);
    expect(parseVersion('1.2')).toEqual([0, 0, 0]);
  });
});

describe('isNewer', () => {
  it('orders by major, then minor, then patch', () => {
    expect(isNewer('0.3.1', '0.3.0')).toBe(true);
    expect(isNewer('0.4.0', '0.3.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.3.0', '0.3.1')).toBe(false);
  });

  it('is false for the same version', () => {
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
    expect(isNewer('v0.3.0', '0.3.0')).toBe(false);
  });

  it('compares numerically, so gaps and multi-digit parts work', () => {
    expect(isNewer('0.3.10', '0.3.9')).toBe(true);
    expect(isNewer('0.3.5', '0.2.4')).toBe(true);
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
  });

  it('ignores a v prefix on either side', () => {
    expect(isNewer('v0.3.1', '0.3.0')).toBe(true);
    expect(isNewer('0.3.1', 'v0.3.0')).toBe(true);
  });

  it('sorts malformed input lowest', () => {
    expect(isNewer('garbage', '0.0.1')).toBe(false);
    expect(isNewer('0.0.1', 'garbage')).toBe(true);
    expect(isNewer('garbage', '')).toBe(false);
  });
});
