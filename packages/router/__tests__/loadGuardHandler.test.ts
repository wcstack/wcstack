import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '../src/parse';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import './setup';

describe('wcs-guard-handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
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
    await new Promise(r => setTimeout(r, 100));

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
    await new Promise(r => setTimeout(r, 100));

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
    await new Promise(r => setTimeout(r, 100));

    const route = router.routeChildNodes[0] as Route;
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
    await new Promise(r => setTimeout(r, 100));

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
    await new Promise(r => setTimeout(r, 100));

    const route = router.routeChildNodes[0] as Route;
    expect(() => route.guardHandler).toThrow();
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
