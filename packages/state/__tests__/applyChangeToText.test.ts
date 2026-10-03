import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToText } from '../src/apply/applyChangeToText';
import { getPathInfo } from '../src/address/PathInfo';
import { setSsrHooks, ssrHooks } from '../src/core/ssrHooks';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

function createBinding(replaceNode: Node): IBindingInfo {
  return {
    propName: 'text',
    propSegments: [],
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    outFilters: [],
    inFilters: [],
    bindingType: 'text',
    uuid: null,
    node: replaceNode,
    replaceNode,
  } as IBindingInfo;
}

// nodeValue への書き込み回数を数える（同値スキップの検証用）
function spyNodeValue(node: Text): { readonly writes: number } {
  let writes = 0;
  let value: string | null = node.nodeValue;
  Object.defineProperty(node, 'nodeValue', {
    get: () => value,
    set: (v: string) => { writes++; value = v; },
    configurable: true,
  });
  return { get writes() { return writes; } };
}

describe('applyChangeToText', () => {
  it('同じ値の場合は変更しないこと', () => {
    const textNode = document.createTextNode('hello');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'hello');
    expect(textNode.nodeValue).toBe('hello');
  });

  it('数値でも同値なら DOM に書き込まないこと（文字列化して比較する）', () => {
    const textNode = document.createTextNode('5');
    const spy = spyNodeValue(textNode);
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 5);
    expect(spy.writes).toBe(0);
    expect(textNode.nodeValue).toBe('5');
  });

  it('数値が変わった場合は文字列化して書き込むこと', () => {
    const textNode = document.createTextNode('5');
    const spy = spyNodeValue(textNode);
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 6);
    expect(spy.writes).toBe(1);
    expect(textNode.nodeValue).toBe('6');
  });

  it('null は空文字として扱い、連続適用では書き込まないこと', () => {
    const textNode = document.createTextNode('x');
    const spy = spyNodeValue(textNode);
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, null);
    expect(textNode.nodeValue).toBe('');
    expect(spy.writes).toBe(1);
    applyChangeToText(binding, dummyContext, null);
    expect(spy.writes).toBe(1);
  });

  it('undefined は空文字として描画されること（nodeValue は nullable DOMString・実ブラウザ準拠）', () => {
    const textNode = document.createTextNode('x');
    const spy = spyNodeValue(textNode);
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, undefined);
    expect(textNode.nodeValue).toBe('');
    expect(spy.writes).toBe(1);
    // 連続適用では書き込まない
    applyChangeToText(binding, dummyContext, undefined);
    expect(spy.writes).toBe(1);
  });

  it('値が異なる場合は更新すること', () => {
    const textNode = document.createTextNode('hello');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'world');
    expect(textNode.nodeValue).toBe('world');
  });

  it('SSRモードでparentNodeが���いテキストノードはコメントを挿入しないこと', () => {
    document.documentElement.setAttribute('data-wcs-server', '');

    // DOMに追加されていないテキストノード（parentNode === null）
    const textNode = document.createTextNode('');
    const binding = createBinding(textNode);
    applyChangeToText(binding, dummyContext, 'test');
    expect(textNode.nodeValue).toBe('test');

    document.documentElement.removeAttribute('data-wcs-server');
  });

  it('SSRモードの境界コメントには ssr 機能の textMarker が返す式を書き、ssr 機能が無い（分割の core）ときはパスだけを書くこと（#373）', () => {
    // Renders one text binding in SSR mode and returns its parent's markup
    const render = (): string => {
      const parent = document.createElement('p');
      const textNode = document.createTextNode('');
      parent.appendChild(textNode);
      const binding = {
        ...createBinding(textNode),
        outFilters: [{ filterName: 'upper', args: [], literals: [], filterFn: (v: unknown) => v }],
      } as IBindingInfo;
      applyChangeToText(binding, dummyContext, 'test');
      return parent.innerHTML;
    };
    document.documentElement.setAttribute('data-wcs-server', '');
    try {
      // This file installs no feature: the path alone, the format before #373
      expect(ssrHooks).toBeNull();
      expect(render()).toBe('<!--@@wcs-text-start:value-->test<!--@@wcs-text-end:value-->');
      setSsrHooks({
        hydrate: async () => false,
        loadState: () => null,
        emitSnapshot: async () => undefined,
        textMarker: (binding) => `${binding.statePathName}|${binding.outFilters[0].filterName}`,
      });
      expect(render()).toBe('<!--@@wcs-text-start:value|upper-->test<!--@@wcs-text-end:value|upper-->');
    } finally {
      setSsrHooks(null);
      document.documentElement.removeAttribute('data-wcs-server');
    }
  });
});
