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

  it('CSP 違反が観測された場合は blob: 許可と src= 退避を促すメッセージで失敗すること', async () => {
    const originalCreate = (URL as any).createObjectURL;
    const originalRevoke = (URL as any).revokeObjectURL;

    // import に失敗する構文エラー入りモジュール
    const badUrl = `data:application/javascript;base64,${btoa('export default {')}`;
    // createObjectURL は購読開始後・import 前に呼ばれるので、ここで違反を発火させれば
    // 実ブラウザで CSP がブロックしたのと同じ順序を再現できる
    const createSpy = vi.fn(() => {
      const violation = new Event('securitypolicyviolation');
      (violation as any).effectiveDirective = 'script-src-elem';
      document.dispatchEvent(violation);
      return badUrl;
    });

    Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

    try {
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = 'export default {';

      await expect(loadFromInnerScript(script, 'state#csp')).rejects.toThrow(
        /state "state#csp" was blocked by Content-Security-Policy/
      );
      await expect(loadFromInnerScript(script, 'state#csp')).rejects.toThrow(/script-src must allow blob:/);
      await expect(loadFromInnerScript(script, 'state#csp')).rejects.toThrow(/src="\.\/state\.js"/);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    }
  });

  it('CSP 以外の失敗では元のエラーを保ち CSP 断定をしないこと', async () => {
    const originalCreate = (URL as any).createObjectURL;
    const originalRevoke = (URL as any).revokeObjectURL;

    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: undefined, configurable: true });

    try {
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = 'export default {';

      // script-src 以外の違反は判定に使わない（誤って CSP 断定しない）
      const unrelated = new Event('securitypolicyviolation');
      (unrelated as any).effectiveDirective = 'style-src';
      document.dispatchEvent(unrelated);

      const error = await loadFromInnerScript(script, 'state#syntax').catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Failed to evaluate the inline <script> of state "state#syntax"/);
      expect((error as Error).message).not.toMatch(/was blocked by Content-Security-Policy/);
      // 原因のエラーは cause として保持する
      expect((error as Error).cause).toBeInstanceOf(Error);
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
