import { describe, it, expect } from 'vitest';
import { raiseError } from '../src/raiseError';

describe('raiseError', () => {
  it('エラーをthrowすること', () => {
    expect(() => {
      raiseError('test error');
    }).toThrow('[wc-router] test error');
  });

  it('カスタムメッセージを含むエラーをthrowすること', () => {
    expect(() => {
      raiseError('custom message');
    }).toThrow('[wc-router] custom message');
  });
});
