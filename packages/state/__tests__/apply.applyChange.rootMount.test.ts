/**
 * applyChange の丸ごとマウント（`state: user`・1 セグメント）のゲート。
 *
 * - 完了前で宣言済み → 書かない（親のオブジェクトをコンポーネントの state プロパティに
 *   載せてしまうと、bindWebComponent がそれを子 state の実体として取り込む）
 * - 未宣言 → 従来どおりプロパティ書き込み
 * - 完了後 → no-op（v2: 配送は翻訳済みバインディング＋単一台帳が担う）
 *
 * docs/state-mount-design.md §3-2、impl-plan P1-1 / P1-2、webComponent/completeWebComponent.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/apply/getValue', () => ({
  getValue: vi.fn(),
}));
vi.mock('../src/bindings/BindingSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/bindings/BindingSession')>();
  return { ...actual, getBindingSession: vi.fn(() => null) };
});
vi.mock('../src/binding/getAbsoluteStateAddressByBinding', () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ absolutePathInfo: {}, listIndex: null })),
  clearAbsoluteStateAddressByBinding: vi.fn(),
}));

import { applyChange } from '../src/apply/applyChange';
import { getValue } from '../src/apply/getValue';
import { getPathInfo } from '../src/address/PathInfo';
import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from '../src/webComponent/completeWebComponent';
import { setStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

let counter = 0;
function defineTag(): string {
  const tag = `am-root-${++counter}`;
  customElements.define(tag, class extends HTMLElement {
    state: Record<string, any> = { editing: false };
  });
  return tag;
}

function createBinding(element: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join('.'),
    propSegments,
    propModifiers: [],
    statePathName: 'user',
    statePathInfo: getPathInfo('user'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'prop',
    uuid: null,
    node: element,
    replaceNode: element,
  } as IBindingInfo;
}

function createContext(): IApplyContext {
  return {
    rootNode: document,
    stateName: 'default',
    stateElement: { hasUpdatedCallback: false } as any,
    state: {} as any,
    appliedBindingSet: new Set(),
    newListValueByAbsAddress: new Map(),
    updatedAbsAddressSetByStateElement: new Map(),
    deferredSelectBindings: [],
  } as IApplyContext;
}

describe('applyChange: 丸ごとマウントのゲート', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.mocked(getValue).mockReturnValue({ name: 'Alice' });
  });

  it('宣言済み・未完了の 1 セグメントバインディングは state プロパティを書かないこと', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);
    const original = el.state;
    markWebComponentStatePropDeclared(el, 'state');

    const binding = createBinding(el, ['state']);
    applyChange(binding, createContext());
    // 2 回目は fnByBinding の「未確定」経路（has が真・get が undefined）を通る
    applyChange(binding, createContext());

    expect(el.state).toBe(original);
  });

  it('宣言済み・未完了は部分規則（state.name）でも書かないこと（v2 の一般化）', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);
    const original = { ...el.state };
    markWebComponentStatePropDeclared(el, 'state');

    applyChange(createBinding(el, ['state', 'name']), createContext());

    expect(el.state).toEqual(original);
  });

  it('未宣言なら従来どおりプロパティに書くこと', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);

    applyChange(createBinding(el, ['state']), createContext());

    expect(el.state).toEqual({ name: 'Alice' });
  });

  it('完了後は no-op（配送は翻訳済みバインディング＋単一台帳が担う）で、プロパティも書かないこと', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);
    const createState = vi.fn();
    setStateElementByWebComponent(el, 'state', { name: 'default', createState } as any);
    markWebComponentStatePropDeclared(el, 'state');
    markWebComponentAsComplete(el, 'state');
    const original = el.state;

    const binding = createBinding(el, ['state']);
    applyChange(binding, createContext());
    // 2 回目は fnByBinding にキャッシュされた経路
    applyChange(binding, createContext());

    expect(createState).not.toHaveBeenCalled();
    expect(el.state).toBe(original);
  });
});
