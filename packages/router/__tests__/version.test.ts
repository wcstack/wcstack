import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version';
import pkg from '../package.json' with { type: 'json' };

describe('VERSION', () => {
  it('package.json のバージョンと一致すること', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('semver形式（major.minor.patch、プレリリースの後置を許す）の文字列であること', () => {
    expect(typeof VERSION).toBe('string');
    // an rc release bumps every package to X.Y.Z-rc.N before publishing
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/);
  });
});
