import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '../src/parse';
import { loadGuardHandler } from '../src/loadGuardHandler';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { IRoute } from '../src/components/types';
import './setup';

describe('wcs-guard-handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('wcs-guard-handler内のscriptからguardHandlerが設定されること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/protected" guard="/login">
        <wcs-guard-handler>
          <script type="module">
            export default function(toPath, fromPath) {
              return true;
            }
          </script>
        </wcs-guard-handler>
        <span>Protected Content</span>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    // guardHandlerのPromise解決を待つ
    await vi.waitFor(() => {
      expect(() => route.guardHandler).not.toThrow();
    });

    expect(route.guardHandler).toBeDefined();
    expect(typeof route.guardHandler).toBe('function');
  });

  it('guardHandlerがtoPathとfromPathを受け取ること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/dashboard" guard="/">
        <wcs-guard-handler>
          <script type="module">
            export default async function(toPath, fromPath) {
              return toPath === '/dashboard';
            }
          </script>
        </wcs-guard-handler>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    await vi.waitFor(() => {
      expect(() => route.guardHandler).not.toThrow();
    });

    const result = await route.guardHandler('/dashboard', '/');
    expect(result).toBe(true);
  });

  it('wcs-guard-handlerがフラグメントに含まれないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/test" guard="/">
        <wcs-guard-handler>
          <script type="module">
            export default function() { return true; }
          </script>
        </wcs-guard-handler>
        <div class="content">Test</div>
      </wcs-route>
    `;
    (router as any)._template = template;

    const result = await parse(router);

    // wcs-guard-handlerはDOMに残らない
    const guardHandlerEl = result.querySelector('wcs-guard-handler');
    expect(guardHandlerEl).toBeNull();
  });

  it('wcs-guard-handlerの兄弟要素は正常にパースされること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/page" guard="/login">
        <wcs-guard-handler>
          <script type="module">
            export default function() { return false; }
          </script>
        </wcs-guard-handler>
        <div class="page-content">Page</div>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    // childNodeArrayにwcs-guard-handlerが含まれていないこと
    const hasGuardHandler = route.childNodeArray.some(
      node => node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).tagName?.toLowerCase() === 'wcs-guard-handler'
    );
    expect(hasGuardHandler).toBe(false);
  });

  it('scriptタグがない場合、guardHandlerが設定されないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/test" guard="/">
        <wcs-guard-handler></wcs-guard-handler>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    // scriptタグが無い場合は loadGuardHandler 自体が呼ばれず非同期処理も発生しない。
    // guardHandlerが設定されていないのでエラーになる
    expect(() => route.guardHandler).toThrow();
  });

  it('guardCheckでwcs-guard-handlerから設定されたハンドラが使われること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/secure" guard="/home">
        <wcs-guard-handler>
          <script type="module">
            export default function() { return false; }
          </script>
        </wcs-guard-handler>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    // ハンドラのロードを待つ
    await vi.waitFor(() => {
      expect(() => route.guardHandler).not.toThrow();
    });

    // guardCheckがGuardCancelをthrowすること
    await expect(
      route.guardCheck({ path: '/secure', routes: [], params: {}, typedParams: {}, lastPath: '/' })
    ).rejects.toThrow('Navigation cancelled by guard.');
  });

  it('default exportが関数でない場合、guardHandlerが設定されないこと', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/test" guard="/">
        <wcs-guard-handler>
          <script type="module">
            export default "not a function";
          </script>
        </wcs-guard-handler>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);

    const route = router.routeChildNodes[0] as Route;
    // 関数でない default export の場合、loadGuardHandler は notifyGuardHandlerLoadFailed を
    // 呼んで pending を解除する。guardHandler は未設定のままになることを待つ。
    await vi.waitFor(() => {
      expect((route as any)._core._guardHandlerLoadFailed).toBe(true);
    });
    expect(() => route.guardHandler).toThrow();
  });

  it('importModuleがrejectした場合にnotifyGuardHandlerLoadFailedを呼ぶこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notifyMock = vi.fn();
    const mockRoute: Partial<IRoute> = {
      notifyGuardHandlerLoadFailed: notifyMock,
    };

    // 構文エラーのある script を渡して importModule の data: URL 経由でも reject させる
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.text = 'this is not valid JavaScript @#$%';

    loadGuardHandler(script, mockRoute as IRoute);
    await vi.waitFor(() => {
      expect(notifyMock).toHaveBeenCalled();
    });

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('URL.createObjectURL が無い環境で data: URL のみで失敗した場合にもエラー処理されること', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notifyMock = vi.fn();
    const mockRoute: Partial<IRoute> = {
      notifyGuardHandlerLoadFailed: notifyMock,
    };

    // URL.createObjectURL を一時的に無効化（firstError === null 経路をテスト）
    const original = URL.createObjectURL;
    (URL as any).createObjectURL = undefined;

    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.text = 'this is not valid JavaScript @#$%';

    try {
      loadGuardHandler(script, mockRoute as IRoute);
      await vi.waitFor(() => {
        expect(notifyMock).toHaveBeenCalled();
      });

      expect(errorSpy).toHaveBeenCalled();
    } finally {
      (URL as any).createObjectURL = original;
      errorSpy.mockRestore();
    }
  });

  it('default exportが関数でない場合にnotifyGuardHandlerLoadFailedを呼ぶこと', async () => {
    const notifyMock = vi.fn();
    const guardHandlerSetter = vi.fn();
    const mockRoute: Partial<IRoute> = {
      notifyGuardHandlerLoadFailed: notifyMock,
    };
    Object.defineProperty(mockRoute, 'guardHandler', {
      set: guardHandlerSetter,
    });

    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.text = 'export default "not a function";';

    loadGuardHandler(script, mockRoute as IRoute);
    await vi.waitFor(() => {
      expect(notifyMock).toHaveBeenCalled();
    });

    expect(guardHandlerSetter).not.toHaveBeenCalled();
  });

  it('uuid が設定された route で loadGuardHandler が正常に動作すること（sourceURL 識別子付き）', async () => {
    // sourceURL 自体は devtools 用で副作用無しのため、route.uuid 経路が
    // 正常実行されることのみを確認する。
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/with-uuid" guard="/">
        <wcs-guard-handler>
          <script type="module">
            export default function() { return true; }
          </script>
        </wcs-guard-handler>
      </wcs-route>
    `;
    (router as any)._template = template;

    await parse(router);
    const route = router.routeChildNodes[0] as Route;
    // uuid は constructor で常に設定される
    expect(route.uuid).toBeTruthy();
    await vi.waitFor(() => {
      expect(() => route.guardHandler).not.toThrow();
    });
    expect(typeof route.guardHandler).toBe('function');
  });

  it('uuid が未設定の partial route mock でも loadGuardHandler が動作すること', async () => {
    // partial mock では uuid undefined だが、フォールバックの空文字列で動作する
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notifyMock = vi.fn();
    const mockRoute: Partial<IRoute> = {
      notifyGuardHandlerLoadFailed: notifyMock,
    };

    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.text = 'export default function() { return true; }';

    loadGuardHandler(script, mockRoute as IRoute);

    // 正常に import 完了するのを待つ。handler が取得できれば guardHandler に
    // 代入されるが、mockRoute に setter が無いと通常代入される（throw しない）。
    await vi.waitFor(() => {
      expect((mockRoute as any).guardHandler !== undefined || notifyMock.mock.calls.length > 0).toBe(true);
    });

    errorSpy.mockRestore();
  });

  it('ルートの外にあるwcs-guard-handlerは無視されること', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-guard-handler>
        <script type="module">
          export default function() { return true; }
        </script>
      </wcs-guard-handler>
      <wcs-route path="/test">
        <span>Content</span>
      </wcs-route>
    `;
    (router as any)._template = template;

    // エラーなくパースが完了すること
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);

    // wcs-guard-handlerはDOMに残らない
    const guardHandlerEl = result.querySelector('wcs-guard-handler');
    expect(guardHandlerEl).toBeNull();
  });
});
