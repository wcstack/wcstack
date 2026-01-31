import { describe, it, expect, vi } from 'vitest';
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

  it('createObjectURL 分岐で読み込み後に revokeObjectURL が呼ばれること', async () => {
    const originalCreate = (URL as any).createObjectURL;
    const originalRevoke = (URL as any).revokeObjectURL;

    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = 'export default { inner: true }';

    const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(`${script.textContent}\n//# sourceURL=state#blob\n`)));
    const dataUrl = `data:application/javascript;base64,${b64}`;

    const createSpy = vi.fn(() => dataUrl);
    const revokeSpy = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, configurable: true });

    try {
      const data = await loadFromInnerScript(script, 'state#blob');
      expect(data).toEqual({ inner: true });
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith(dataUrl);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    }
  });

  it('default が object でない場合は空オブジェクトを返すこと', async () => {
    const originalCreate = (URL as any).createObjectURL;
    const originalRevoke = (URL as any).revokeObjectURL;

    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: undefined, configurable: true });

    try {
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = 'export default 123';

      const data = await loadFromInnerScript(script, 'state#not-object');
      expect(data).toEqual({});
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    }
  });
});
