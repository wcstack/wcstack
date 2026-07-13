import { describe, it, expect } from 'vitest';
import { scanDeclaredBindings } from '../src/core/declaredScan';

function build(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('scanDeclaredBindings', () => {
  it('data-wcs属性の複数エントリをパースすること', () => {
    const root = build('<span data-wcs="textContent: count; class.plus: count|gt(0)"></span>');
    const result = scanDeclaredBindings(root);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      propName: 'textContent', path: 'count', stateName: 'default', origin: 'attribute',
    });
    expect(result[1]).toMatchObject({
      propName: 'class.plus', path: 'count', filters: ['gt(0)'],
    });
  });

  it('@stateNameとフィルタ連鎖を分解すること', () => {
    const root = build('<input data-wcs="value: user.name@app|uc|trim">');
    const [entry] = scanDeclaredBindings(root);
    expect(entry.path).toBe('user.name');
    expect(entry.stateName).toBe('app');
    expect(entry.filters).toEqual(['uc', 'trim']);
  });

  it('templateのfor/if宣言も属性として拾うこと', () => {
    const root = build('<template data-wcs="for: users"></template>');
    const [entry] = scanDeclaredBindings(root);
    expect(entry).toMatchObject({ propName: 'for', path: 'users' });
  });

  it('空・不正なエントリを無視すること', () => {
    const root = build('<span data-wcs=";  ; nocolon; prop: "></span>');
    expect(scanDeclaredBindings(root)).toHaveLength(0);
  });

  it('wcs-textコメントをtextContent宣言として拾うこと', () => {
    const root = build('<p><!--wcs-text: message@main--></p>');
    const [entry] = scanDeclaredBindings(root);
    expect(entry).toMatchObject({
      propName: 'textContent', path: 'message', stateName: 'main', origin: 'comment',
    });
    expect(entry.element.tagName).toBe('P');
  });

  it('wcs-forコメントをfor宣言として拾い、本文なしコメントは無視すること', () => {
    const root = build('<div><!--wcs-for: items--><!--wcs-else--><!--unrelated comment--></div>');
    const result = scanDeclaredBindings(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ propName: 'for', path: 'items', origin: 'comment' });
  });

  it('親要素のないコメントを無視すること', () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createComment('wcs-text: orphan'));
    expect(scanDeclaredBindings(fragment)).toHaveLength(0);
  });

  it('バインド属性名の変更に追随できること', () => {
    const root = build('<span data-bind="textContent: count"></span>');
    expect(scanDeclaredBindings(root)).toHaveLength(0);
    const result = scanDeclaredBindings(root, 'data-bind');
    expect(result).toHaveLength(1);
  });

  it('Documentを起点に走査できること', () => {
    document.body.innerHTML = '<span data-wcs="textContent: docLevel"></span>';
    try {
      const result = scanDeclaredBindings(document);
      expect(result.some((entry) => entry.path === 'docLevel')).toBe(true);
    } finally {
      document.body.innerHTML = '';
    }
  });
});
