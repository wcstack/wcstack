import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootstrapRouter } from '../src/bootstrapRouter';
import { config, setConfig } from '../src/config';

describe('bootstrapRouter', () => {
  beforeEach(() => {
    // Reset custom elements registry by checking if already defined
  });

  afterEach(() => {
    // Cleanup if needed
  });

  it('設定なしで呼び出した場合、デフォルト設定でコンポーネントが登録されること', () => {
    bootstrapRouter();

    expect(customElements.get(config.tagNames.router)).toBeDefined();
    expect(customElements.get(config.tagNames.route)).toBeDefined();
    expect(customElements.get(config.tagNames.outlet)).toBeDefined();
    expect(customElements.get(config.tagNames.link)).toBeDefined();
    expect(customElements.get(config.tagNames.layout)).toBeDefined();
    expect(customElements.get(config.tagNames.layoutOutlet)).toBeDefined();
    expect(customElements.get(config.tagNames.head)).toBeDefined();
  });

  it('設定ありで呼び出した場合、設定が反映されること', () => {
    // 既にコンポーネントは登録されているが、設定は反映される
    bootstrapRouter({
      enableShadowRoot: true
    });

    expect(config.enableShadowRoot).toBe(true);
    
    // リセット
    setConfig({
      enableShadowRoot: false
    });
  });

  it('basenameFileExtensionsを指定できること', () => {
    // setConfigで直接設定変更をテスト
    setConfig({
      basenameFileExtensions: ['.html', '.htm']
    });

    expect(config.basenameFileExtensions).toEqual(['.html', '.htm']);
    
    // リセット
    setConfig({
      basenameFileExtensions: ['.html']
    });
  });
});
