/**
 * v2: applyChangeToWebComponent は意図的な no-op。
 *
 * state プロパティのバインディングは全てマウント（webComponent/mountScope.ts）で、
 * 配送は「翻訳されたバインディング＋単一台帳＋静的依存」が担う — v1 の親→子
 * 再読込通知チャネル（innerState への $postUpdate）はこの経路では何も運ぶものが無い。
 * ここではその契約（何もしない・何も要求しない）を固定する。
 */
import { describe, it, expect } from 'vitest';
import { applyChangeToWebComponent } from '../src/apply/applyChangeToWebComponent';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

function createBinding(element: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName: 'value',
    statePathInfo: getPathInfo('value'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

describe('applyChangeToWebComponent（v2: no-op）', () => {
  it('要素の状態に関わらず何もせず、値もプロパティも触らないこと', () => {
    const el = document.createElement('div') as any;
    el.state = { name: 'authored' };
    const original = el.state;

    // 1 セグメント（ルート規則相当）・複数セグメント・未登録要素のどれでも no-op
    for (const segments of [['state'], ['state', 'name'], ['other']]) {
      expect(() =>
        applyChangeToWebComponent(createBinding(el, segments), {} as IApplyContext, { name: 'incoming' }),
      ).not.toThrow();
    }
    expect(el.state).toBe(original);
    expect(el.state.name).toBe('authored');
  });
});
