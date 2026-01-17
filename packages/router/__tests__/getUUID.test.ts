import { describe, it, expect, vi } from 'vitest';
import { getUUID } from '../src/getUUID';

describe('getUUID', () => {
  it('UUIDを生成できること', () => {
    const uuid = getUUID();
    expect(uuid).toBeDefined();
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);
  });

  it('毎回異なるUUIDを生成すること', () => {
    const uuid1 = getUUID();
    const uuid2 = getUUID();
    const uuid3 = getUUID();
    
    expect(uuid1).not.toBe(uuid2);
    expect(uuid2).not.toBe(uuid3);
    expect(uuid1).not.toBe(uuid3);
  });

  it('crypto.randomUUIDがある場合�Eそれを使用すること', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: vi.fn(() => 'fixed-uuid') },
    });

    const uuid = getUUID();

    expect(uuid).toBe('fixed-uuid');
    expect((globalThis as any).crypto.randomUUID).toHaveBeenCalled();

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });

  it('crypto.randomUUIDがなぁE��合�EフォールバックでUUIDを生成すること', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });

    const uuid = getUUID();

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });
});
