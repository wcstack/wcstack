import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '../src/parse';
import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { Layout } from '../src/components/Layout';
import * as parseModule from '../src/parse';
import './setup';

describe('parse', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (Router as any)._instance = null;
    vi.clearAllMocks();
  });

  it('parse関数が存在すること', () => {
    expect(parse).toBeDefined();
    expect(typeof parse).toBe('function');
  });

  it('空のテンプレートをパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
  });

  it('通常のHTMLノードをパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = '<div>Hello World</div>';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.querySelector('div')?.textContent).toBe('Hello World');
  });

  it('テキストノードをパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = 'Plain text content';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.textContent).toBe('Plain text content');
  });

  it('wc-layoutをパースしてlayout-outletに置き換えること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = '<wc-layout>Layout content</wc-layout>';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    // wc-layout-outletが作成されていることを確認
    const layoutOutlet = result.querySelector('wc-layout-outlet');
    expect(layoutOutlet).not.toBeNull();
  });

  it('wc-layoutの子要素を正しく処理すること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <wc-layout>
        <header>Header</header>
        <main>Main</main>
      </wc-layout>
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const layoutOutlet = result.querySelector('wc-layout-outlet');
    expect(layoutOutlet).not.toBeNull();
  });

  it('複数のwc-layoutを同時にパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <wc-layout>
        <header>Header 1</header>
      </wc-layout>
      <wc-layout>
        <header>Header 2</header>
      </wc-layout>
    `;
    
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const layoutOutlets = result.querySelectorAll('wc-layout-outlet');
    expect(layoutOutlets.length).toBe(2);
  });

  it('通常の要素とwc-layoutが混在する場合に正しくパースすること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="container">
        <wc-layout>Layout content</wc-layout>
        <footer>Footer</footer>
      </div>
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const resultContainer = result.querySelector('.container');
    expect(resultContainer).not.toBeNull();
    expect(resultContainer?.querySelector('footer')?.textContent).toBe('Footer');
    expect(resultContainer?.querySelector('wc-layout-outlet')).not.toBeNull();
  });

  it('深くネストされた構造をパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <div>
        <section>
          <wc-layout>
            <div>
              <wc-layout>
                <span>Deep content</span>
              </wc-layout>
            </div>
          </wc-layout>
        </section>
      </div>
    `;
    
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    // Nested layout-outlets should exist
    const layoutOutlets = result.querySelectorAll('wc-layout-outlet');
    expect(layoutOutlets.length).toBeGreaterThan(0);
  });

  it('コメントノード以外の非要素ノードを保持すること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = 'Text before<div>Element</div>Text after';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.textContent).toContain('Text before');
    expect(result.textContent).toContain('Text after');
  });

  it('複数の異なるノードタイプを含むテンプレートをパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      Text node
      <div>HTML Element</div>
      <wc-layout><header>Layout Header</header></wc-layout>
      More text
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.querySelector('div')).not.toBeNull();
    expect(result.querySelector('wc-layout-outlet')).not.toBeNull();
    expect(result.textContent).toContain('Text node');
    expect(result.textContent).toContain('More text');
  });

  it('wc-routeをパースしてプレースホルダーに置き換えること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = '<wc-route path="/test"><span>Child</span></wc-route>';
    (router as any)._template = template;

    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);

    const commentNodes = Array.from(result.childNodes).filter(
      (node) => node.nodeType === Node.COMMENT_NODE
    ) as Comment[];

    expect(commentNodes.length).toBeGreaterThan(0);
    expect(commentNodes[0].data).toContain('@@route:');
  });

  it('ネストされたwc-routeをパースできること', async () => {
    const router = document.createElement('wc-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wc-route path="/parent">
        <wc-route path="/child"><span>Child</span></wc-route>
      </wc-route>
    `;
    (router as any)._template = template;

    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);

    const commentNodes = Array.from(result.childNodes).filter(
      (node) => node.nodeType === Node.COMMENT_NODE
    ) as Comment[];

    expect(commentNodes.length).toBe(1);
    expect(commentNodes[0].data).toContain('@@route:');
  });
});
