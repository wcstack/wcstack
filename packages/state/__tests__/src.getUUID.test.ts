import { describe, it, expect, vi } from 'vitest';
import { getUUID } from '../src/getUUID';

describe('getUUID', () => {
  it('crypto.randomUUIDがあればそれを使うこと', () => {
    const originalCrypto = (globalThis as any).crypto;
    const randomUUID = vi.fn().mockReturnValue('uuid-mock');
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID },
      configurable: true
    });

    try {
      expect(getUUID()).toBe('uuid-mock');
      expect(randomUUID).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('crypto.randomUUIDがない場合はフォールバックすること', () => {
    const originalCrypto = (globalThis as any).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });

    try {
      const uuid = getUUID();
      expect(uuid).toMatch(/^[0-9a-f-]{36}$/i);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });
});
