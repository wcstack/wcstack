import { describe, it, expect } from 'vitest';
import { getUUID } from '../src/getUUID';

describe('getUUID', () => {
  it('ユニークなIDを生成すること', () => {
    const uuid1 = getUUID();
    const uuid2 = getUUID();
    expect(uuid1).not.toBe(uuid2);
    expect(typeof uuid1).toBe('string');
    expect(uuid1.startsWith('u')).toBe(true);
  });
});

