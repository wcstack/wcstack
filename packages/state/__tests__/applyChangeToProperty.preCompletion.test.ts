/**
 * applyChangeToProperty が、`bind-component` 完了前の親→子書き込みを控えること
 * （webComponent/preCompletionWrites.ts）。
 * - 1 セグメント・オブジェクト → オブジェクト・カスタム要素: 置き換え前を控える
 * - 2 セグメント・作者のオブジェクトに無いキー・カスタム要素: 注入キーを控える
 * それ以外の書き込みは台帳に触らない。
 */
import { describe, it, expect } from 'vitest';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';
import { getPathInfo } from '../src/address/PathInfo';
import { takeOverwrittenObject, getInjectedKeys } from '../src/webComponent/preCompletionWrites';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const context = { stateName: 'default', stateElement: {} as any, state: {} as any, appliedBindingSet: new Set() } as IApplyContext;

// isPossibleTwoWay は未定義のカスタム要素で raiseError するので、タグは定義してから使う
let counter = 0;
function createCustomElement(): any {
  const tag = `pc-card-${++counter}`;
  customElements.define(tag, class extends HTMLElement {});
  return document.createElement(tag);
}

function binding(node: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName: 'user',
    statePathInfo: getPathInfo('user'),
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe('applyChangeToProperty: 完了前の書き込みの控え', () => {
  it('カスタム要素のオブジェクト値プロパティをオブジェクトで置き換えるとき、置き換え前を控えること', () => {
    const el = createCustomElement();
    const authored = { editing: false };
    el.state = authored;
    const incoming = { name: 'Alice' };

    applyChangeToProperty(binding(el, ['state']), context, incoming);

    expect(el.state).toBe(incoming);
    expect(takeOverwrittenObject(el, 'state')).toBe(authored);
  });

  it('カスタム要素でなければ控えないこと', () => {
    const el = document.createElement('div') as any;
    el.state = { editing: false };

    applyChangeToProperty(binding(el, ['state']), context, { name: 'Alice' });

    expect(takeOverwrittenObject(el, 'state')).toBeUndefined();
  });

  it('プリミティブへの置き換え・プリミティブからの置き換えは控えないこと', () => {
    const el = createCustomElement();
    el.state = { editing: false };
    applyChangeToProperty(binding(el, ['state']), context, 'text');
    expect(takeOverwrittenObject(el, 'state')).toBeUndefined();

    el.count = 1;
    applyChangeToProperty(binding(el, ['count']), context, { n: 2 });
    expect(takeOverwrittenObject(el, 'count')).toBeUndefined();
  });

  it('2 セグメントで作者のオブジェクトに無いキーを作るとき、注入キーを控えること', () => {
    const el = createCustomElement();
    el.state = { message: '' };

    applyChangeToProperty(binding(el, ['state', 'theme']), context, { mode: 'light' });
    applyChangeToProperty(binding(el, ['state', 'message']), context, 'hello');

    expect(el.state.theme).toEqual({ mode: 'light' });
    expect(el.state.message).toBe('hello');
    // theme は注入・message は元からあった
    expect([...getInjectedKeys(el, 'state')!]).toEqual(['theme']);
  });

  it('2 セグメントでもカスタム要素でなければ注入キーを控えないこと', () => {
    const el = document.createElement('div') as any;
    el.state = {};

    applyChangeToProperty(binding(el, ['state', 'theme']), context, { mode: 'light' });

    expect(el.state.theme).toEqual({ mode: 'light' });
    expect(getInjectedKeys(el, 'state')).toBeUndefined();
  });

  it('3 セグメント以上は注入キーの対象外であること', () => {
    const el = createCustomElement();
    el.state = { theme: {} };

    applyChangeToProperty(binding(el, ['state', 'theme', 'mode']), context, 'dark');

    expect(el.state.theme.mode).toBe('dark');
    expect(getInjectedKeys(el, 'state')).toBeUndefined();
  });
});
