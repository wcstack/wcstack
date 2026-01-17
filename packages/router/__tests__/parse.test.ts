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

  it('parse髢｢謨ｰ縺悟ｭ伜惠縺吶ｋ縺薙→', () => {
    expect(parse).toBeDefined();
    expect(typeof parse).toBe('function');
  });

  it('遨ｺ縺ｮ繝・Φ繝励Ξ繝ｼ繝医ｒ繝代・繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
  });

  it('騾壼ｸｸ縺ｮHTML繝弱・繝峨ｒ繝代・繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = '<div>Hello World</div>';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.querySelector('div')?.textContent).toBe('Hello World');
  });

  it('繝・く繧ｹ繝医ヮ繝ｼ繝峨ｒ繝代・繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = 'Plain text content';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.textContent).toBe('Plain text content');
  });

  it('wcs-layout繧偵ヱ繝ｼ繧ｹ縺励※layout-outlet縺ｫ鄂ｮ縺肴鋤縺医ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = '<wcs-layout>Layout content</wcs-layout>';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    // wcs-layout-outlet縺御ｽ懈・縺輔ｌ縺ｦ縺・ｋ縺薙→繧堤｢ｺ隱・
    const layoutOutlet = result.querySelector('wcs-layout-outlet');
    expect(layoutOutlet).not.toBeNull();
  });

  it('wcs-layout縺ｮ蟄占ｦ∫ｴ繧呈ｭ｣縺励￥蜃ｦ逅・☆繧九％縺ｨ', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-layout>
        <header>Header</header>
        <main>Main</main>
      </wcs-layout>
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const layoutOutlet = result.querySelector('wcs-layout-outlet');
    expect(layoutOutlet).not.toBeNull();
  });

  it('隍・焚縺ｮwcs-layout繧貞酔譎ゅ↓繝代・繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-layout>
        <header>Header 1</header>
      </wcs-layout>
      <wcs-layout>
        <header>Header 2</header>
      </wcs-layout>
    `;
    
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const layoutOutlets = result.querySelectorAll('wcs-layout-outlet');
    expect(layoutOutlets.length).toBe(2);
  });

  it('騾壼ｸｸ縺ｮ隕∫ｴ縺ｨwcs-layout縺梧ｷｷ蝨ｨ縺吶ｋ蝣ｴ蜷医↓豁｣縺励￥繝代・繧ｹ縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="container">
        <wcs-layout>Layout content</wcs-layout>
        <footer>Footer</footer>
      </div>
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    const resultContainer = result.querySelector('.container');
    expect(resultContainer).not.toBeNull();
    expect(resultContainer?.querySelector('footer')?.textContent).toBe('Footer');
    expect(resultContainer?.querySelector('wcs-layout-outlet')).not.toBeNull();
  });

  it('豺ｱ縺上ロ繧ｹ繝医＆繧後◆讒矩繧偵ヱ繝ｼ繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      <div>
        <section>
          <wcs-layout>
            <div>
              <wcs-layout>
                <span>Deep content</span>
              </wcs-layout>
            </div>
          </wcs-layout>
        </section>
      </div>
    `;
    
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    
    // Nested layout-outlets should exist
    const layoutOutlets = result.querySelectorAll('wcs-layout-outlet');
    expect(layoutOutlets.length).toBeGreaterThan(0);
  });

  it('繧ｳ繝｡繝ｳ繝医ヮ繝ｼ繝我ｻ･螟悶・髱櫁ｦ∫ｴ繝弱・繝峨ｒ菫晄戟縺吶ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = 'Text before<div>Element</div>Text after';
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.textContent).toContain('Text before');
    expect(result.textContent).toContain('Text after');
  });

  it('隍・焚縺ｮ逡ｰ縺ｪ繧九ヮ繝ｼ繝峨ち繧､繝励ｒ蜷ｫ繧繝・Φ繝励Ξ繝ｼ繝医ｒ繝代・繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);
    
    const template = document.createElement('template');
    template.innerHTML = `
      Text node
      <div>HTML Element</div>
      <wcs-layout><header>Layout Header</header></wcs-layout>
      More text
    `;
    (router as any)._template = template;
    
    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);
    expect(result.querySelector('div')).not.toBeNull();
    expect(result.querySelector('wcs-layout-outlet')).not.toBeNull();
    expect(result.textContent).toContain('Text node');
    expect(result.textContent).toContain('More text');
  });

  it('wcs-route繧偵ヱ繝ｼ繧ｹ縺励※繝励Ξ繝ｼ繧ｹ繝帙Ν繝繝ｼ縺ｫ鄂ｮ縺肴鋤縺医ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = '<wcs-route path="/test"><span>Child</span></wcs-route>';
    (router as any)._template = template;

    const result = await parse(router);
    expect(result).toBeInstanceOf(DocumentFragment);

    const commentNodes = Array.from(result.childNodes).filter(
      (node) => node.nodeType === Node.COMMENT_NODE
    ) as Comment[];

    expect(commentNodes.length).toBeGreaterThan(0);
    expect(commentNodes[0].data).toContain('@@route:');
  });

  it('繝阪せ繝医＆繧後◆wcs-route繧偵ヱ繝ｼ繧ｹ縺ｧ縺阪ｋ縺薙→', async () => {
    const router = document.createElement('wcs-router') as Router;
    document.body.appendChild(router);

    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-route path="/parent">
        <wcs-route path="/child"><span>Child</span></wcs-route>
      </wcs-route>
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
