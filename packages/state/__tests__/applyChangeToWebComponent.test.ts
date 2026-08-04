import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChangeToWebComponent } from '../src/apply/applyChangeToWebComponent';
import { setStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';
import type { IApplyContext } from '../src/apply/types';

const dummyContext: IApplyContext = {
  stateName: 'default',
  stateElement: {} as any,
  state: {} as any,
  appliedBindingSet: new Set(),
};

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

function bindProbeStateElement(element: Element, stateProp: string) {
  const posted: string[] = [];
  const mutabilities: string[] = [];
  const stateElement = {
    name: 'default',
    createState(mutability: string, callback: (state: any) => void) {
      mutabilities.push(mutability);
      callback({ $postUpdate: (path: string) => { posted.push(path); } });
    },
  } as any;
  setStateElementByWebComponent(element, stateProp, stateElement);
  return { posted, mutabilities };
}

describe('applyChangeToWebComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propSegmentsが1以下の場合はエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, ['state']);
    expect(() => applyChangeToWebComponent(binding, dummyContext, 'value'))
      .toThrow(/Invalid propSegments for web component binding/);
  });

  it('bind-component済みでない要素はエラーになること', () => {
    const el = document.createElement('div');
    const binding = createBinding(el, ['state', 'title']);
    expect(() => applyChangeToWebComponent(binding, dummyContext, 'value'))
      .toThrow(/State element not bound to "state" on web component/);
  });

  // G1: 値は運ばず「そのパスを読み直せ」という通知だけを送る。値の正本は親 state 側にあり、
  // 子は innerState proxy のマッピング経由で親を読みに行く。
  // 以前は element[stateProp] という公開プロパティを経由していたため、
  // 受け側 proxy の write が no-op である必要があり、それが this.state を壊していた。
  it('公開プロパティを経由せず$postUpdateで通知すること', () => {
    const el = document.createElement('div') as any;
    // 公開プロパティに触れたら気づけるよう罠を仕掛ける
    Object.defineProperty(el, 'state', {
      get() { throw new Error('outer proxy must not be touched'); },
      configurable: true,
    });
    const { posted, mutabilities } = bindProbeStateElement(el, 'state');

    const binding = createBinding(el, ['state', 'title']);
    applyChangeToWebComponent(binding, dummyContext, 'new-title');

    expect(posted).toEqual(['title']);
    expect(mutabilities).toEqual(['readonly']);
  });

  it('ネストしたパスはドット結合されて通知されること', () => {
    const el = document.createElement('div');
    const { posted } = bindProbeStateElement(el, 'state');

    const binding = createBinding(el, ['state', 'user', 'name']);
    applyChangeToWebComponent(binding, dummyContext, 'Alice');

    expect(posted).toEqual(['user.name']);
  });

  it('通知は値に依存しないこと', () => {
    const el = document.createElement('div');
    const { posted } = bindProbeStateElement(el, 'state');

    const binding = createBinding(el, ['state', 'title']);
    applyChangeToWebComponent(binding, dummyContext, undefined);
    applyChangeToWebComponent(binding, dummyContext, 'x');

    expect(posted).toEqual(['title', 'title']);
  });
});
