import { describe, it, expect } from 'vitest';
import { loadFromInnerScript } from '../src/stateLoader/loadFromInnerScript';

describe('loadFromInnerScript', () => {
  it('module scriptから状態を読み込めること（fallback）', async () => {
    const originalCreate = (URL as any).createObjectURL;
    const originalRevoke = (URL as any).revokeObjectURL;

    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: undefined, configurable: true });

    try {
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = 'export default { inner: true }';

      const data = await loadFromInnerScript(script, 'state#test');
      expect(data).toEqual({ inner: true });
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    }
  });
});
