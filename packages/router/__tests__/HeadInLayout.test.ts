import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './setup';
import { Router } from '../src/components/Router';
import { _resetHeadStack } from '../src/components/Head';

describe('Head in Layout', () => {
  let originalTitle: string;
  let originalHeadHTML: string;

  beforeEach(() => {
    _resetHeadStack();
    (Router as any)._instance = null;
    document.body.innerHTML = '';
    originalTitle = document.title;
    originalHeadHTML = document.head.innerHTML;
  });

  afterEach(() => {
    document.title = originalTitle;
    document.head.innerHTML = originalHeadHTML;
    _resetHeadStack();
  });

  it('レイアウト内の<wcs-head>が適用されること', async () => {
    const layoutTemplate = document.createElement('template');
    layoutTemplate.id = 'test-layout';
    layoutTemplate.innerHTML = `
      <wcs-head>
        <title>Layout Title</title>
        <meta name="layout-meta" content="layout-value" />
      </wcs-head>
      <div class="layout">
        <slot></slot>
      </div>
    `;
    document.body.appendChild(layoutTemplate);

    const router = document.createElement('wcs-router') as Router;
    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-layout name="main" layout="test-layout">
        <wcs-route path="/">
          <div>Home</div>
        </wcs-route>
        <wcs-route path="/page">
          <div>Page Content</div>
        </wcs-route>
      </wcs-layout>
    `;
    router.appendChild(template);

    await router.connectedCallback();
    await router.navigate('/page');

    expect(document.title).toBe('Layout Title');
    const meta = document.head.querySelector('meta[name="layout-meta"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('layout-value');
  });

  it('ページ個別の<wcs-head>がレイアウトの<wcs-head>より優先されること', async () => {
    const layoutTemplate = document.createElement('template');
    layoutTemplate.id = 'test-layout';
    layoutTemplate.innerHTML = `
      <wcs-head>
        <title>Layout Title</title>
        <meta name="layout-meta" content="layout-value" />
      </wcs-head>
      <div class="layout">
        <slot></slot>
      </div>
    `;
    document.body.appendChild(layoutTemplate);

    const router = document.createElement('wcs-router') as Router;
    const template = document.createElement('template');
    template.innerHTML = `
      <wcs-layout name="main" layout="test-layout">
        <wcs-route path="/">
          <div>Home</div>
        </wcs-route>
        <wcs-route path="/page-override">
          <wcs-head>
            <title>Page Title</title>
          </wcs-head>
          <div>Page Content</div>
        </wcs-route>
      </wcs-layout>
    `;
    router.appendChild(template);

    await router.connectedCallback();
    await router.navigate('/page-override');

    expect(document.title).toBe('Page Title');
    const meta = document.head.querySelector('meta[name="layout-meta"]');
    expect(meta).not.toBeNull();
  });
});
