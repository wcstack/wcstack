import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version';
import pkg from '../package.json' with { type: 'json' };

describe('VERSION', () => {
  it('package.json のバージョンと一致すること', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('semver形式（major.minor.patch）の文字列であること', () => {
    expect(typeof VERSION).toBe('string');
    const parts = VERSION.split('.');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    parts.slice(0, 3).forEach(p => {
      expect(Number.isFinite(Number(p))).toBe(true);
    });
  });
});
