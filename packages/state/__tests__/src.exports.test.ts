import { describe, it, expect } from 'vitest';
import { bootstrapState } from '../src/exports';

describe('exports', () => {
  it('bootstrapStateがエクスポートされていること', () => {
    expect(bootstrapState).toBeDefined();
    expect(typeof bootstrapState).toBe('function');
  });
});
