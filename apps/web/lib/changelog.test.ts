import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG } from './changelog';
import { isNewer, parseVersion } from './semver';
import pkg from '../package.json';

describe('CHANGELOG invariants', () => {
  it('has at least one entry', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it('newest entry version equals apps/web/package.json version', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('every version is plain x.y.z', () => {
    for (const e of CHANGELOG) expect(e.version, e.id).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('versions never increase going down the list (newest first)', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(isNewer(CHANGELOG[i].version, CHANGELOG[i - 1].version), CHANGELOG[i].id).toBe(false);
    }
    expect(parseVersion(CHANGELOG[0].version)).not.toEqual([0, 0, 0]);
  });

  it('ids are unique', () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dates are real ISO dates and never increase going down the list', () => {
    for (const e of CHANGELOG) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10), e.id).toBe(e.date);
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i].date <= CHANGELOG[i - 1].date, CHANGELOG[i].id).toBe(true);
    }
  });

  it('every entry has a title, a summary and at least one bullet, with no em dashes', () => {
    for (const e of CHANGELOG) {
      expect(e.title.trim(), e.id).not.toBe('');
      expect(e.summary.trim(), e.id).not.toBe('');
      expect(e.bullets.length, e.id).toBeGreaterThan(0);
      const text = [e.title, e.summary, ...e.bullets].join(' ');
      expect(text, e.id).not.toContain('—');
    }
  });
});
