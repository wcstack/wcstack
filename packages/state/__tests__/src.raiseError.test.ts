import { describe, it, expect } from 'vitest';
import { raiseError } from '../src/raiseError';

describe('raiseError', () => {
  it('メッセージを付与して例外を投げること', () => {
    expect(() => raiseError('test')).toThrow(/\[@wcstack\/state\] test/);
  });
});
