import { describe, it, expect } from 'vitest';
import { defineState } from '../src/defineState';

describe('defineState', () => {
  it('引数をそのまま返す（アイデンティティ関数）', () => {
    const definition = {
      count: 0,
      name: "test",
      increment() { /* noop */ },
    };
    const result = defineState(definition);
    expect(result).toBe(definition);
  });
});
