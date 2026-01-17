import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Layout } from '../src/components/Layout';
import './setup';

describe('Layout', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('Layoutクラスが存在すること', () => {
    expect(Layout).toBeDefined();
    expect(typeof Layout).toBe('function');
  });

  it('HTMLElementを継承していること', () => {
    expect(Object.getPrototypeOf(Layout.prototype)).toBe(HTMLElement.prototype);
  });

  it('インスタンスを作成できること', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    expect(layout).toBeInstanceOf(Layout);
    expect(layout).toBeInstanceOf(HTMLElement);
  });

  it('name属性を取得できること', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    layout.setAttribute('name', 'test-layout');
    document.body.appendChild(layout);
    expect(layout.name).toBe('test-layout');
  });

  it('name属性がない場合、空文字列を返すこと', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    document.body.appendChild(layout);
    expect(layout.name).toBe('');
  });

  it('connectedCallbackで初期化されること', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    layout.setAttribute('name', 'connected-test');
    
    // DOMに接続される前はnameが空
    expect(layout.name).toBe('');
    
    // DOMに接続されるとconnectedCallbackが呼ばれて初期化される
    document.body.appendChild(layout);
    expect(layout.name).toBe('connected-test');
  });

  it('_initializeは一度だけ呼ばれること', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    layout.setAttribute('name', 'init-once');
    
    // 最初に接続
    document.body.appendChild(layout);
    expect(layout.name).toBe('init-once');
    
    // 削除して再接続
    layout.remove();
    layout.setAttribute('name', 'changed-name');
    document.body.appendChild(layout);
    
    // 初期化は一度だけなので、名前は変わらない
    expect(layout.name).toBe('init-once');
  });

  it('uuid プロパティを持つこと', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    expect(layout.uuid).toBeDefined();
    expect(typeof layout.uuid).toBe('string');
    expect(layout.uuid.length).toBeGreaterThan(0);
  });

  it('異なるインスタンスは異なるuuidを持つこと', () => {
    const layout1 = document.createElement('wcs-layout') as Layout;
    const layout2 = document.createElement('wcs-layout') as Layout;
    expect(layout1.uuid).not.toBe(layout2.uuid);
  });

  it('enableShadowRoot属性がenable-shadow-rootを持つ時にtrueを返すこと', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    layout.setAttribute('enable-shadow-root', '');
    expect(layout.enableShadowRoot).toBe(true);
  });

  it('enableShadowRoot属性がdisable-shadow-rootを持つ時にfalseを返すこと', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    layout.setAttribute('disable-shadow-root', '');
    expect(layout.enableShadowRoot).toBe(false);
  });

  it('enableShadowRoot属性が未指定時にconfig.enableShadowRootを返すこと', () => {
    const layout = document.createElement('wcs-layout') as Layout;
    expect(typeof layout.enableShadowRoot).toBe('boolean');
  });

  describe('loadTemplate', () => {
    it('layout属性でドキュメントからテンプレートを読み込めること', async () => {
      const templateEl = document.createElement('template');
      templateEl.id = 'test-template';
      templateEl.innerHTML = '<div>Test Content</div>';
      document.body.appendChild(templateEl);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('layout', 'test-template');

      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('<div>Test Content</div>');
    });

    it('layout属性でHTMLElement(非template)からテンプレートを読み込めないこと', async () => {
      const divEl = document.createElement('div');
      divEl.id = 'test-div';
      divEl.innerHTML = '<div>Test Content</div>';
      document.body.appendChild(divEl);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('layout', 'test-div');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('could not find template with id "test-div"')
      );
      warnSpy.mockRestore();
    });

    it('存在しないlayout IDの場合に警告を出すこと', async () => {
      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('layout', 'nonexistent-id');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('could not find template with id "nonexistent-id"')
      );
      warnSpy.mockRestore();
    });

    it('src属性でテンプレートをフェッチできること', async () => {
      const mockResponse = new Response('<div>Fetched Content</div>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('src', '/test-layout.html');

      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('<div>Fetched Content</div>');
      expect((globalThis as any).fetch).toHaveBeenCalledWith('/test-layout.html');
    });

    it('キャッシュがある場合、フェッチせずキャッシュを使うこと', async () => {
      const mockResponse = new Response('<div>Cached Content</div>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);

      const layout1 = document.createElement('wcs-layout') as Layout;
      layout1.setAttribute('src', '/cached-layout.html');
      await layout1.loadTemplate();

      const layout2 = document.createElement('wcs-layout') as Layout;
      layout2.setAttribute('src', '/cached-layout.html');
      const template = await layout2.loadTemplate();

      expect(template.innerHTML).toBe('<div>Cached Content</div>');
      expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    });

    it('フェッチに失敗した場合にエラーを投げること', async () => {
      const mockResponse = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('src', '/nonexistent.html');

      await expect(layout.loadTemplate()).rejects.toThrow();
    });

    it('ネットワークエラーの場合にエラーを投げること', async () => {
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('src', '/error.html');

      await expect(layout.loadTemplate()).rejects.toThrow();
    });

    it('srcとlayout両方が指定された場合に警告を出すこと', async () => {
      const mockResponse = new Response('<div>Content</div>', {
        status: 200,
      });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('src', '/test.html');
      layout.setAttribute('layout', 'test-id');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await layout.loadTemplate();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('have both "src" and "layout" attributes')
      );
      warnSpy.mockRestore();
    });

    it('srcとlayout未指定の場合、空のテンプレートを返すこと', async () => {
      const layout = document.createElement('wcs-layout') as Layout;
      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('');
    });

    it('フェッチしたコンテンツが空の場合も正しく処理できること', async () => {
      const mockResponse = new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);

      const layout = document.createElement('wcs-layout') as Layout;
      layout.setAttribute('src', '/empty.html');

      const template = await layout.loadTemplate();
      expect(template.innerHTML).toBe('');
    });

    it('キャッシュにundefinedが含まれる場合のフォールバック処理', async () => {
      // まずキャッシュを構築
      const mockResponse = new Response('<div>Content</div>', { status: 200 });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);
      
      const layout1 = document.createElement('wcs-layout') as Layout;
      layout1.setAttribute('src', '/test-undefined.html');
      await layout1.loadTemplate();
      
      // Layoutモジュールの内部キャッシュにアクセスして値をundefinedに設定
      // これは通常起こらないが、|| ''のフォールバックをテストするため
      const LayoutModule = await import('../src/components/Layout.js');
      const cacheSymbol = Object.getOwnPropertySymbols(LayoutModule).find(
        s => s.toString() === 'Symbol(cache)'
      );
      
      // 代わりに、response.text()がundefinedを返すケースをモック
      const mockUndefinedResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(undefined),
      };
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockUndefinedResponse as any);
      
      const layout2 = document.createElement('wcs-layout') as Layout;
      layout2.setAttribute('src', '/test-undefined2.html');
      const template = await layout2.loadTemplate();
      
      // undefinedが''にフォールバックされることを確認
      expect(template.innerHTML).toBe('');
    });

    it('キャッシュに空文字列が含まれる場合のフォールバック処理', async () => {
      // 空文字列をキャッシュに設定
      const mockResponse = new Response('', { status: 200 });
      (globalThis as any).fetch = vi.fn().mockResolvedValue(mockResponse);
      
      const layout1 = document.createElement('wcs-layout') as Layout;
      layout1.setAttribute('src', '/empty-cache.html');
      await layout1.loadTemplate();
      
      // 同じソースを再度読み込み、キャッシュから取得
      const layout2 = document.createElement('wcs-layout') as Layout;
      layout2.setAttribute('src', '/empty-cache.html');
      const template = await layout2.loadTemplate();
      
      // 空文字列がそのまま返されることを確認（|| ''のフォールバック対象外）
      expect(template.innerHTML).toBe('');
      // フェッチは1回だけ呼ばれる（キャッシュが使われた）
      expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    });
  });
});
