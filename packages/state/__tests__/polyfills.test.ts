import { describe, it, expect } from 'vitest';

describe('polyfills', () => {
  it('Set.difference と Set.intersection を提供すること', async () => {
    const origDifference = (Set.prototype as any).difference;
    const origIntersection = (Set.prototype as any).intersection;

    try {
      delete (Set.prototype as any).difference;
      delete (Set.prototype as any).intersection;

      await import('../src/polyfills');

      expect(typeof (Set.prototype as any).difference).toBe('function');
      expect(typeof (Set.prototype as any).intersection).toBe('function');

      const a = new Set([1, 2, 3]);
      const b = new Set([2, 4]);
      expect((a as any).difference(b)).toEqual(new Set([1, 3]));
      expect((a as any).intersection(b)).toEqual(new Set([2]));
    } finally {
      if (typeof origDifference === 'undefined') {
        delete (Set.prototype as any).difference;
      } else {
        (Set.prototype as any).difference = origDifference;
      }
      if (typeof origIntersection === 'undefined') {
        delete (Set.prototype as any).intersection;
      } else {
        (Set.prototype as any).intersection = origIntersection;
      }
    }
  });
});
