import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version';
import pkg from '../package.json';

describe('VERSION', () => {
  it('package.json の version と一致する', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('semver 形式である', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
