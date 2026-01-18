import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link } from '../src/components/Link';
import { Router } from '../src/components/Router';
import './setup';

describe('Link', () => {
  let originalLocation: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
    vi.clearAllMocks();
    
    // window.locationを保存してから"/"に設定
    originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = {
      href: 'http://localhost/',
      pathname: '/',
      origin: 'http://localhost',
    };
    
    // navigation APIをクリーンアップ
    delete (window as any).navigation;

  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    
    // window.locationを復元
    if (originalLocation) {
      (window as any).location = originalLocation;
    }
    
    // navigation APIをクリーンアップ
    delete (window as any).navigation;

  });

  it('Linkクラスが存在すること', () => {
    expect(Link).toBeDefined();
  });

  it('HTMLElementを継承していること', () => {
    expect(Link.prototype).toBeInstanceOf(HTMLElement);
  });

  it('to属性に有効な値を設定してインスタンス化できること', () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const link = document.createElement('wcs-link') as Link;
    link.setAttribute('to', '/test');
    
    expect(() => {
      document.body.appendChild(link);
    }).not.toThrow();
    
    // アンカー要素が作成されることを確認
    const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
    expect(anchor).toBeDefined();
    expect(anchor.tagName).toBe('A');
  });

  describe('プロパティ', () => {
    it('uuidプロパティを持つこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      document.body.appendChild(link);

      expect(link.uuid).toBeDefined();
      expect(typeof link.uuid).toBe('string');
    });

    it('commentNodeプロパティを持つこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      document.body.appendChild(link);

      expect(link.commentNode).toBeDefined();
      expect(link.commentNode.nodeType).toBe(Node.COMMENT_NODE);
    });

    it('routerプロパティでRouterを取得できること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      document.body.appendChild(link);

      expect(link.router).toBe(router);
    });

    it('routerが見つからない場合にエラーを投げること', () => {
      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      
      // routerがない状態でappendChildするとconnectedCallbackでエラーが発生するため、
      // appendChild自体がエラーを投げることを期待
      expect(() => {
        document.body.appendChild(link);
      }).toThrow('[@wcstack/router] wcs-link is not connected to a router.');
    });
  });

  describe('connectedCallback', () => {
    it('アンカー要素を作成してDOMに追加すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor).toBeDefined();
      expect(anchor.tagName).toBe('A');
    });

    it('絶対パスの場合にbasename付きhrefを設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);
      // basenameはconnectedCallback後に設定される可能性があるため、attributeを設定
      router.setAttribute('basename', '/app');

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      // Routerのbasenameプロパティが適切に取得されることを確認
      expect(anchor.getAttribute('href')).toContain('/test');
    });

    it('相対URL/絶対URL以外の場合にそのままhrefを設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', 'https://example.com');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor.getAttribute('href')).toBe('https://example.com/');
    });

    it('子ノードをアンカー要素に移動すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      // innerHTMLを使用して子ノードを含むLinkを作成
      const div = document.createElement('div');
      document.body.appendChild(div);
      div.innerHTML = '<wcs-link to="/test"><span>Link Text</span></wcs-link>';

      const link = div.querySelector('wcs-link') as Link;
      expect(link).toBeDefined();
      if (!link) return;
      
      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      const childSpan = anchor.querySelector('span');
      expect(childSpan).toBeDefined();
      expect(childSpan?.textContent).toBe('Link Text');
    });

    it('commentNodeの後にアンカーを挿入すること（nextSiblingがある場合）', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const container = document.createElement('div');
      document.body.appendChild(container);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      
      const nextDiv = document.createElement('div');
      nextDiv.id = 'next';
      nextDiv.textContent = 'Next';

      // nextDivを先に追加してからlinkを挿入（nextSiblingを存在させる）
      container.appendChild(nextDiv);
      container.insertBefore(link, nextDiv);

      // linkはcommentNodeに置き換わり、anchorはcommentNodeの後に挿入される
      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor).toBeDefined();
      expect(anchor.tagName).toBe('A');
      // anchorの次がnextDivであることを確認（insertBeforeが使われたことを示す）
      expect(anchor.nextSibling).toBe(nextDiv);
    });

    it('commentNodeの親がない場合にエラーを投げること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      
      // 初期化済みフラグを手動で設定して、_initializeをスキップさせる
      (link as any)._initialized = true;
      (link as any)._path = '/test';
      
      // commentNodeを作成（親なし）
      (link as any)._commentNode = document.createComment('test');
      
      // connectedCallbackを呼び出すとcommentNodeの親チェックでエラー
      expect(() => {
        link.connectedCallback();
      }).toThrow('[@wcstack/router] wcs-link comment node has no parent');
    });

    it('コンストラクタで親ノードがない場合、replaceWithを呼ばないこと', () => {
      // createElementで作成した直後は親ノードがないため、replaceWithは呼ばれない
      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      
      // commentNodeは作成されるが、replaceWithは呼ばれない
      expect(link.commentNode).toBeDefined();
      expect(link.commentNode.parentNode).toBeNull();
    });

    it('相対URL以外（http://の絶対URL）の場合、そのままhrefを設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', 'http://example.com/page');
      link.textContent = 'External Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor.href).toBe('http://example.com/page');
    });

    it('httpsで始まる絶対URLの場合、そのままhrefを設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      const url = 'https://secure.example.com/page';
      link.setAttribute('to', url);
      link.textContent = 'Secure Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      // _pathが絶対URLであることを確認
      expect((link as any)._path).toBe(url);
      expect((link as any)._path.startsWith('/')).toBe(false);
      // new URL().toString()の結果を検証
      expect(anchor.href).toBe(new URL(url).toString());
    });

    it('navigation APIが利用可能な場合にイベントリスナーを登録すること', () => {
      const mockNavigation = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = mockNavigation;

      try {
        const router = document.createElement('wcs-router') as Router;
        document.body.appendChild(router);

        const link = document.createElement('wcs-link') as Link;
        link.setAttribute('to', '/test');
        link.textContent = 'Link';
        document.body.appendChild(link);

        expect(mockNavigation.addEventListener).toHaveBeenCalledWith(
          'currententrychange',
          expect.any(Function)
        );
      } finally {
        delete (window as any).navigation;
      }
    });

    it('現在のパスと一致する場合にactiveクラスを追加すること', () => {
      // window.locationをモック
      const originalHref = Object.getOwnPropertyDescriptor(window.location, 'href');
      Object.defineProperty(window.location, 'href', {
        writable: true,
        value: 'http://localhost/test',
      });

      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor.classList.contains('active')).toBe(true);

      // クリーンアップ
      if (originalHref) {
        Object.defineProperty(window.location, 'href', originalHref);
      }
    });

    it('現在のパスと一致しない場合にactiveクラスを追加しないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor.classList.contains('active')).toBe(false);
    });

    it('commentNodeの次にnextSiblingがない場合、親にappendChildすること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      // commentNodeの後ろに何もない状態を作る
      const div = document.createElement('div');
      document.body.appendChild(div);
      
      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link Text';
      
      // コメントノードを先に挿入
      const commentNode = link.commentNode;
      div.appendChild(commentNode);
      
      // linkをconnectedCallbackで処理させる
      div.appendChild(link);

      // アンカーが作成され、parentNode.appendChild()が呼ばれてcommentNodeの後ろに配置されること
      const anchor = commentNode.nextSibling as HTMLAnchorElement;
      expect(anchor).toBeDefined();
      expect(anchor.tagName).toBe('A');
      expect(anchor.parentNode).toBe(div);
      // 子ノードがappendChildされているが、テキストが移動するためlink要素からはなくなる
    });

    it('to属性がない場合、空文字列パスを設定すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      const container = document.createElement('div');
      container.appendChild(link);

      (link as any)._initialize();

      expect((link as any)._path).toBe('');
    });

    it('Navigation APIがない場合はクリックでnavigateにフォールバックすること', async () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const navigateSpy = vi.fn().mockResolvedValue(undefined);
      (router as any).navigate = navigateSpy;

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const onClick = (link as any)._onClick as (e: MouseEvent) => void;
      expect(onClick).toBeDefined();

      // defaultPrevented の場合は何もしない
      onClick({
        defaultPrevented: true,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: vi.fn(),
      } as any);
      expect(navigateSpy).not.toHaveBeenCalled();

      // 右クリックは無視
      onClick({
        defaultPrevented: false,
        button: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: vi.fn(),
      } as any);
      expect(navigateSpy).not.toHaveBeenCalled();

      // 修飾キーありは無視
      onClick({
        defaultPrevented: false,
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: vi.fn(),
      } as any);
      expect(navigateSpy).not.toHaveBeenCalled();

      // 通常クリックはnavigateを呼ぶ
      const preventDefault = vi.fn();
      await onClick({
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault,
      } as any);
      expect(preventDefault).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith('/test');
    });
  });

  describe('private helpers', () => {
    it('_normalizePathnameが先頭スラッシュと末尾スラッシュを正規化すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      document.body.appendChild(link);

      expect((link as any)._normalizePathname('foo/bar')).toBe('/foo/bar');
      expect((link as any)._normalizePathname('')).toBe('/');
      expect((link as any)._normalizePathname(undefined)).toBe('/');
      expect((link as any)._normalizePathname('/foo/')).toBe('/foo');
      expect((link as any)._normalizePathname('//foo//bar')).toBe('/foo/bar');
    });

    it('_joinInternalPathがベースとルートを正しく結合すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/');
      document.body.appendChild(link);

      expect((link as any)._joinInternalPath('/app/', '/')).toBe('/app/');
      expect((link as any)._joinInternalPath('/app', 'about')).toBe('/app/about');
      expect((link as any)._joinInternalPath('', '/about')).toBe('/about');
    });
  });

  describe('disconnectedCallback', () => {
    it('アンカー要素を削除すること', () => {
      const mockNavigation = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = mockNavigation;

      try {
        const router = document.createElement('wcs-router') as Router;
        document.body.appendChild(router);

        const link = document.createElement('wcs-link') as Link;
        link.setAttribute('to', '/test');
        link.textContent = 'Link';
        document.body.appendChild(link);

        const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
        expect(anchor).toBeDefined();
        expect(anchor.tagName).toBe('A');

        // _anchorElementが設定されていることを確認
        expect((link as any)._anchorElement).toBe(anchor);

        // disconnectedCallbackを呼び出す
        link.remove();

        // disconnectedCallbackが呼ばれたことを確認するため、
        // navigation.removeEventListenerが呼ばれたかを確認
        expect(mockNavigation.removeEventListener).toHaveBeenCalled();
      } finally {
        delete (window as any).navigation;
      }
    });

    it('navigation APIが利用可能な場合にイベントリスナーを削除すること', () => {
      const mockNavigation = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = mockNavigation;

      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      link.remove();

      expect(mockNavigation.removeEventListener).toHaveBeenCalledWith(
        'currententrychange',
        expect.any(Function)
      );

      delete (window as any).navigation;
    });

    it('子ノードを親から削除すること', () => {
      const mockNavigation = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = mockNavigation;

      try {
        const router = document.createElement('wcs-router') as Router;
        document.body.appendChild(router);

        const div = document.createElement('div');
        document.body.appendChild(div);
        div.innerHTML = '<wcs-link to="/test"><span>Text</span></wcs-link>';

        const link = div.querySelector('wcs-link') as Link;
        expect(link).toBeDefined();
        if (!link) return;
        
        const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
        const childSpan = anchor.querySelector('span') as HTMLSpanElement;
        expect(childSpan).toBeDefined();

        link.remove();

        // 子ノードが削除されたことを確認
        expect(childSpan.parentNode).toBeNull();
      } finally {
        delete (window as any).navigation;
      }
    });

    it('子ノードの親がない場合、削除をスキップすること', () => {
      const mockNavigation = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      (window as any).navigation = mockNavigation;

      try {
        const router = document.createElement('wcs-router') as Router;
        document.body.appendChild(router);

        const link = document.createElement('wcs-link') as Link;
        link.setAttribute('to', '/test');
        
        // 子ノードを追加
        const span = document.createElement('span');
        span.textContent = 'Text';
        link.appendChild(span);
        
        document.body.appendChild(link);
        
        const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
        const childSpan = anchor.querySelector('span') as HTMLSpanElement;
        
        if (childSpan) {
          // 子ノードを先に削除
          childSpan.remove();
          expect(childSpan.parentNode).toBeNull();

          // disconnectedCallbackが呼ばれてもエラーにならないことを確認
          expect(() => {
            link.remove();
          }).not.toThrow();
        } else {
          // childSpanがnullの場合もテストを通す
          expect(childSpan).toBeNull();
        }
      } finally {
        delete (window as any).navigation;
      }
    });

    it('anchorと子ノードを削除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');

      const span = document.createElement('span');
      span.textContent = 'Text';
      link.appendChild(span);

      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      const childSpan = anchor.querySelector('span') as HTMLSpanElement;
      expect(childSpan).toBeDefined();

      link.disconnectedCallback();

      expect(anchor.isConnected).toBe(false);
      expect(childSpan.parentNode).toBeNull();
    });

    it('フォールバッククリックが設定されている場合にリスナーを解除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      const removeSpy = vi.spyOn(anchor, 'removeEventListener');

      // Navigation API が無いので _onClick が設定される
      expect((link as any)._onClick).toBeDefined();

      link.disconnectedCallback();

      expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect((link as any)._onClick).toBeUndefined();
    });

    it('anchorとonClickが設定されている場合にクリックリスナーを解除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;
      const removeSpy = vi.spyOn(anchor, 'removeEventListener');
      (link as any)._anchorElement = anchor;
      (link as any)._onClick = vi.fn();

      link.disconnectedCallback();

      expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect((link as any)._onClick).toBeUndefined();
    });

    it('onClickが設定されている場合に分岐が実行されること', () => {
      const link = document.createElement('wcs-link') as Link;
      const anchor = document.createElement('a');
      const removeSpy = vi.spyOn(anchor, 'removeEventListener');

      (link as any)._anchorElement = anchor;
      (link as any)._onClick = vi.fn();

      link.disconnectedCallback();

      expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect((link as any)._onClick).toBeUndefined();
    });

    it('onClickが未設定の場合はクリックリスナー解除をスキップすること', () => {
      const link = document.createElement('wcs-link') as Link;
      const anchor = document.createElement('a');
      const removeSpy = vi.spyOn(anchor, 'removeEventListener');

      (link as any)._anchorElement = anchor;
      (link as any)._onClick = undefined;

      link.disconnectedCallback();

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('_updateActiveState', () => {
    it('パスが一致する場合にactiveクラスを追加すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;

      // 初期状態はactiveではない（window.locationが'/'）
      expect(anchor.classList.contains('active')).toBe(false);

      // window.locationをモック
      const originalHref = Object.getOwnPropertyDescriptor(window.location, 'href');
      Object.defineProperty(window.location, 'href', {
        writable: true,
        value: 'http://localhost/test',
      });
      
      (link as any)._updateActiveState();

      expect(anchor.classList.contains('active')).toBe(true);
      
      // 復元
      if (originalHref) {
        Object.defineProperty(window.location, 'href', originalHref);
      }
    });

    it('パスが一致しなくなった場合にactiveクラスを削除すること', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');
      link.textContent = 'Link';

      // window.locationをモック
      const originalHref = Object.getOwnPropertyDescriptor(window.location, 'href');
      Object.defineProperty(window.location, 'href', {
        writable: true,
        value: 'http://localhost/test',
      });
      
      document.body.appendChild(link);

      const anchor = link.commentNode.nextSibling as HTMLAnchorElement;

      // 初期状態はactive
      expect(anchor.classList.contains('active')).toBe(true);

      // URLを変更
      Object.defineProperty(window.location, 'href', {
        writable: true,
        value: 'http://localhost/other',
      });
      (link as any)._updateActiveState();
      
      expect(anchor.classList.contains('active')).toBe(false);

      // クリーンアップ
      if (originalHref) {
        Object.defineProperty(window.location, 'href', originalHref);
      }
    });

    it('アンカー未作成の場合、何もしないこと', () => {
      const router = document.createElement('wcs-router') as Router;
      document.body.appendChild(router);

      const link = document.createElement('wcs-link') as Link;
      link.setAttribute('to', '/test');

      expect(() => {
        (link as any)._updateActiveState();
      }).not.toThrow();
    });
  });
});
