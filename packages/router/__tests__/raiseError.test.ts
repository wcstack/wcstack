import { describe, it, expect } from 'vitest';
import { raiseError } from '../src/raiseError';

describe('raiseError', () => {
  it('エラーをthrowすること', () => {
    expect(() => {
      raiseError('test error');
    }).toThrow('[@wcstack/router] test error');
  });

  it('カスタムメチE��ージを含むエラーをthrowすること', () => {
    expect(() => {
      raiseError('custom message');
    }).toThrow('[@wcstack/router] custom message');
  });
});
