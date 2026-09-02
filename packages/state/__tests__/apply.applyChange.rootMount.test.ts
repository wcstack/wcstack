/**
 * applyChange の丸ごとマウント（`state: user`・1 セグメント）のゲート。
 *
 * - 完了前で宣言済み → 書かない（親のオブジェクトをコンポーネントの state プロパティに
 *   載せてしまうと、bindWebComponent がそれを子 state の実体として取り込む）
 * - 未宣言 → 従来どおりプロパティ書き込み
 * - 完了後 → 値を運ばない再読込通知（登録済みパスの先頭セグメント全部）
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

  it('未宣言なら従来どおりプロパティに書くこと', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);

    applyChange(createBinding(el, ['state']), createContext());

    expect(el.state).toEqual({ name: 'Alice' });
  });

  it('完了後は登録済みパスの先頭セグメント全部を読み直す通知になり、以後キャッシュされること', () => {
    const el = document.createElement(defineTag()) as any;
    document.body.appendChild(el);
    const posted: string[] = [];
    setStateElementByWebComponent(el, 'state', {
      name: 'default',
      boundPaths: new Set(['name', 'tags.*.name']),
      createState(_mode: string, cb: (state: any) => void) {
        cb({ $postUpdate: (path: string) => { posted.push(path); } });
      },
    } as any);
    markWebComponentStatePropDeclared(el, 'state');
    markWebComponentAsComplete(el, 'state');
    const original = el.state;

    const binding = createBinding(el, ['state']);
    applyChange(binding, createContext());
    applyChange(binding, createContext());

    expect(posted).toEqual(['name', 'tags', 'name', 'tags']);
    expect(el.state).toBe(original);
  });
});
