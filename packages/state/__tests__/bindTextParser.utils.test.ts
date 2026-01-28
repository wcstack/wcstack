import { describe, it, expect } from 'vitest';
import { trimFn } from '../src/bindTextParser/utils';

describe('trimFn', () => {
  it('前後の空白をトリムすること', () => {
    expect(trimFn('  hello  ')).toBe('hello');
  });
});
