import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindComponentLifecycleHooks } from "../src/webComponent/bindComponentLifecycle";

vi.mock('../src/stateLoader/loadFromInnerScript', () => ({
  loadFromInnerScript: vi.fn().mockResolvedValue({ fromInner: true })
}));
vi.mock('../src/stateLoader/loadFromJsonFile', () => ({
  loadFromJsonFile: vi.fn().mockResolvedValue({ fromJson: true })
}));
vi.mock('../src/stateLoader/loadFromScriptFile', () => ({
  loadFromScriptFile: vi.fn().mockResolvedValue({ fromScript: true })
}));
vi.mock('../src/stateLoader/loadFromScriptJson', () => ({
  loadFromScriptJson: vi.fn().mockReturnValue({ fromScriptJson: true })
}));
vi.mock('../src/proxy/StateHandler', () => ({
  createStateProxy: vi.fn((_rootNode: any, state: any) => state)
}));
vi.mock('../src/webComponent/bindWebComponent', () => ({
  bindWebComponent: vi.fn()
}));
vi.mock('../src/bindings/initializeBindingPromiseByNode', () => ({
  waitInitializeBinding: vi.fn().mockResolvedValue(undefined)
}));

import { State } from '../src/components/State';
import { getStateElement, setStateElement } from '../src/stateElementByName';
import { loadFromInnerScript } from '../src/stateLoader/loadFromInnerScript';
import { loadFromJsonFile } from '../src/stateLoader/loadFromJsonFile';
import { loadFromScriptFile } from '../src/stateLoader/loadFromScriptFile';
import { loadFromScriptJson } from '../src/stateLoader/loadFromScriptJson';
import { createStateProxy } from '../src/proxy/StateHandler';
import { connectedCallbackSymbol, disconnectedCallbackSymbol } from '../src/proxy/symbols';
import { bindWebComponent } from '../src/webComponent/bindWebComponent';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const loadFromInnerScriptMock = vi.mocked(loadFromInnerScript);
const loadFromJsonFileMock = vi.mocked(loadFromJsonFile);
const loadFromScriptFileMock = vi.mocked(loadFromScriptFile);
const loadFromScriptJsonMock = vi.mocked(loadFromScriptJson);
const createStateProxyMock = vi.mocked(createStateProxy);
const bindWebComponentMock = vi.mocked(bindWebComponent);

const STATE_TAG = 'wcs-state-test';
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

const createStateElement = (attrs?: Record<string, string>): State => {
  const el = document.createElement(STATE_TAG) as State;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  return el;
};

const ensureHostDefined = () => {
  if (!customElements.get('x-host')) {
    customElements.define('x-host', class extends HTMLElement {});
  }
};

const createHostWithState = (stateEl: State): HTMLElement => {
  ensureHostDefined();
  const host = document.createElement('x-host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(stateEl);
  return host;
};

const getStateValue = async (stateEl: State): Promise<any> => {
  let value: any;
  await stateEl.createState('readonly', (state) => {
    value = state;
  });
  return value;
};

const createBindingInfo = (overrides?: Partial<IBindingInfo>): IBindingInfo => ({
  propName: 'value',
  propSegments: ['value'],
  propModifiers: [],
  statePathName: 'count',
  statePathInfo: getPathInfo('count'),
  outFilters: [],
  inFilters: [],
  bindingType: 'prop',
  uuid: null,
  node: document.createElement('input'),
  replaceNode: document.createElement('input'),
  ...overrides,
} as IBindingInfo);

describe('State component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setStateElement(document, null);
    setStateElement(document, null);
    createStateProxyMock.mockImplementation((_rootNode: any, state: any) => state);
    loadFromInnerScriptMock.mockResolvedValue({ fromInner: true });
    loadFromJsonFileMock.mockResolvedValue({ fromJson: true });
    loadFromScriptFileMock.mockResolvedValue({ fromScript: true });
    loadFromScriptJsonMock.mockReturnValue({ fromScriptJson: true });
  });

  afterEach(() => {
    setStateElement(document, null);
    setStateElement(document, null);
    vi.clearAllMocks();
  });

  it('初期状態でcreateStateがエラーになること', () => {
    const stateEl = createStateElement();
    expect(() => stateEl.createState('readonly', () => {})).toThrow(/State rootNode is not available/);
  });

  // §2.2: initializePromise の同期版。DCC の setter が「今すぐ書いてよいか」を判断する。
  it('initializedはconnect前false・初期化後trueになること', async () => {
    const stateEl = createStateElement();
    expect(stateEl.initialized).toBe(false);

    stateEl.setInitialState({ count: 0 });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(stateEl.initialized).toBe(true);
  });

  it('commandTokenNamesは初期状態で空Set、setInitialState後に$commandTokens宣言を反映すること', async () => {
    const stateEl = createStateElement();
    expect(stateEl.commandTokenNames.size).toBe(0);
    stateEl.setInitialState({ $commandTokens: ['fetchUsers', 'refreshOrders'] });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(Array.from(stateEl.commandTokenNames)).toEqual(['fetchUsers', 'refreshOrders']);
  });

  it('eventTokenNamesは初期状態で空Set、setInitialState後に$eventTokens宣言を反映すること', async () => {
    const stateEl = createStateElement();
    expect(stateEl.eventTokenNames.size).toBe(0);
    stateEl.setInitialState({ $eventTokens: ['userCreated', 'createFailed'] });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(Array.from(stateEl.eventTokenNames)).toEqual(['userCreated', 'createFailed']);
  });

  it('_stateが未初期化状態でcreateStateがエラーになること', () => {
    const stateEl = createStateElement();
    (stateEl as any)._rootNode = document;
    expect(() => stateEl.createState('readonly', () => {})).toThrow(/_state is not initialized yet/);
  });

  it('connectedCallbackで初期化されること（スクリプトなし）', async () => {
    const stateEl = createStateElement();
    // スクリプトも属性もないので、setInitialStateで状態を注入
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    const value = await getStateValue(stateEl);
    expect(value).toEqual({});
  });

  it('connectedCallbackは2回目以降何もしないこと', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
  });

  it('connectedCallbackで内包スクリプトを読み込めること', async () => {
    const stateEl = createStateElement();
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = 'export default { value: 1 };';
    stateEl.appendChild(script);

    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromInnerScriptMock).toHaveBeenCalledTimes(1);
    const value = await getStateValue(stateEl);
    expect(value).toEqual({ fromInner: true });
  });

  it('name 属性は v2 で撤去 — mount への誘導付きで fail-fast すること', async () => {
    const stateEl = createStateElement({ name: 'foo' });
    stateEl.setInitialState({});
    await expect(stateEl.connectedCallback()).rejects.toThrow(/"name" attribute was removed in v2/);
    await expect(stateEl.connectedCallback()).rejects.toThrow(/mount="foo"/);
    // fail-fast でも初期化待ちはウェッジしない
    await stateEl.initializePromise;
  });

  it('state属性でスクリプトJSONを読み込めること', async () => {
    const stateEl = createStateElement({ state: 'state-data' });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromScriptJsonMock).toHaveBeenCalledWith('state-data');
    return expect(getStateValue(stateEl)).resolves.toEqual({ fromScriptJson: true });
  });

  it('state属性が設定済みの場合はinitializeで読み込みをスキップすること', async () => {
    const stateEl = createStateElement({ state: 'state-data' });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromInnerScriptMock).not.toHaveBeenCalled();
  });

  it('src属性でjsonを読み込めること', async () => {
    const stateEl = createStateElement({ src: 'data.json' });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromJsonFileMock).toHaveBeenCalledWith('data.json');
    const value = await getStateValue(stateEl);
    expect(value).toEqual({ fromJson: true });
  });

  it('src属性でjsを読み込めること', async () => {
    const stateEl = createStateElement({ src: 'data.js' });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromScriptFileMock).toHaveBeenCalledWith('data.js');
    const value = await getStateValue(stateEl);
    expect(value).toEqual({ fromScript: true });
  });

  it('src属性の拡張子が不正な場合はエラーになること', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stateEl = createStateElement({ src: 'data.txt' });
    await expect(stateEl.connectedCallback()).rejects.toThrow(/Unsupported src file type/);
    // #257: ロードの失敗も connectedCallbackPromise へ届く（元のエラーのまま — 包み直さない）。
    // initializePromise は解決したままで、ページ全体の初期化待ちを道連れにしない
    await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/Unsupported src file type/);
    await expect(stateEl.initializePromise).resolves.toBeUndefined();
    expect(stateEl.initialized).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('createState呼び出しごとにproxyが作成されること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    const callCountAfterConnect = createStateProxyMock.mock.calls.length;
    const state1 = await getStateValue(stateEl);
    const state2 = await getStateValue(stateEl);
    expect(createStateProxyMock).toHaveBeenCalledTimes(callCountAfterConnect + 2);
    expect(state1).toBe(state2);
  });

  it('getterを持つstateはgetterPathsに追加されること', async () => {
    const stateEl = createStateElement({ state: 'state-data' });
    loadFromScriptJsonMock.mockReturnValue({
      get computed() {
        return 1;
      }
    });

    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(stateEl.getterPaths.has('computed')).toBe(true);
  });

  it('setterを持つstateはsetterPathsに追加されること', async () => {
    const stateEl = createStateElement({ state: 'state-data' });
    let _value = 0;
    loadFromScriptJsonMock.mockReturnValue({
      get value() {
        return _value;
      },
      set value(v: number) {
        _value = v;
      }
    });

    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(stateEl.setterPaths.has('value')).toBe(true);
  });

  it('createStateAsyncで非同期コールバックを実行できること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    
    let callbackExecuted = false;
    await stateEl.createStateAsync('readonly', async (state) => {
      await Promise.resolve();
      callbackExecuted = true;
    });
    
    expect(callbackExecuted).toBe(true);
    expect(createStateProxyMock).toHaveBeenCalled();
  });

  it('各種getterが取得できること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();

    expect(stateEl.initializePromise).toBeInstanceOf(Promise);
    expect(stateEl.listPaths).toBeInstanceOf(Set);
    expect(stateEl.elementPaths).toBeInstanceOf(Set);
    expect(stateEl.getterPaths).toBeInstanceOf(Set);
    expect(stateEl.setterPaths).toBeInstanceOf(Set);
    expect(stateEl.loopContextStack).toBeDefined();
    expect(stateEl.dynamicDependency).toBeInstanceOf(Map);
    expect(stateEl.staticDependency).toBeInstanceOf(Map);
    expect(stateEl.version).toBe(0);
  });

  it('setBindingInfoでlistPathsが更新されること', () => {
    const stateEl = createStateElement();

    stateEl.setPathInfo('items', 'for');

    expect(stateEl.listPaths.has('items')).toBe(true);
    expect(stateEl.elementPaths.has('items.*')).toBe(true);
  });

  it('setBindingInfoの再登録で静的依存が重複しないこと', () => {
    const stateEl = createStateElement();

    stateEl.setPathInfo('user.name', 'text');
    stateEl.setPathInfo('user.name', 'text');

    const deps = stateEl.staticDependency.get('user') || [];
    expect(deps).toEqual(['user.name']);
  });

  it('setBindingInfoで親パスの静的依存が登録されること', () => {
    const stateEl = createStateElement();

    stateEl.setPathInfo('user.name', 'text');

    const deps = stateEl.staticDependency.get('user') || [];
    expect(deps).toContain('user.name');
  });

  it('setPathInfoで深いパスを登録した時に既に登録済みの親依存関係がある場合はループを抜けること', () => {
    const stateEl = createStateElement();

    // 1. a.b を登録 (a -> a.b)
    stateEl.setPathInfo('a.b', 'text');
    
    const depsA = stateEl.staticDependency.get('a') || [];
    expect(depsA).toEqual(['a.b']);

    // spy on addStaticDependency to verify break
    const spy = vi.spyOn(stateEl, 'addStaticDependency');

    // 2. a.b.c を登録 (a.b -> a.b.c, then attempts a -> a.b)
    stateEl.setPathInfo('a.b.c', 'text');

    // a.b -> a.b.c is registered
    const depsAB = stateEl.staticDependency.get('a.b') || [];
    expect(depsAB).toEqual(['a.b.c']);

    // Check that it returned false for the second call
    expect(spy).toHaveReturnedWith(false);
  });

  it('addStaticDependencyとaddDynamicDependencyが重複を防ぐこと', () => {
    const stateEl = createStateElement();
    stateEl.addStaticDependency('parent', 'child');
    stateEl.addStaticDependency('parent', 'child');
    stateEl.addStaticDependency('parent', 'child2');

    const staticDeps = stateEl.staticDependency.get('parent') || [];
    expect(staticDeps).toEqual(['child', 'child2']);

    stateEl.addDynamicDependency('getter', 'dep');
    stateEl.addDynamicDependency('getter', 'dep');
    stateEl.addDynamicDependency('getter', 'dep2');

    const dynamicDeps = stateEl.dynamicDependency.get('getter') || [];
    expect(dynamicDeps).toEqual(['dep', 'dep2']);
  });

  it('nextVersionでバージョンがインクリメントされること', () => {
    const stateEl = createStateElement();
    expect(stateEl.nextVersion()).toBe(1);
    expect(stateEl.nextVersion()).toBe(2);
  });

  it('disconnectedCallbackで登録が解除されること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    const rootNode = stateEl.rootNode;
    expect(getStateElement(rootNode)).toBe(stateEl);
    stateEl.disconnectedCallback();
    expect(getStateElement(rootNode)).toBeNull();
  });

  it('disconnectedCallbackを2回呼んでもエラーにならないこと', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    stateEl.disconnectedCallback();
    stateEl.disconnectedCallback(); // _rootNode is already null
  });

  it('$connectedCallbackが定義されている場合connectedCallback時に呼ばれること', async () => {
    const connectedFn = vi.fn();
    const state = {
      $connectedCallback: connectedFn,
      [connectedCallbackSymbol]: () => connectedFn(),
    };
    const stateEl = createStateElement();
    stateEl.setInitialState(state);
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(connectedFn).toHaveBeenCalledTimes(1);
  });

  it('$disconnectedCallbackが定義されている場合disconnectedCallback時に呼ばれること', async () => {
    const disconnectedFn = vi.fn();
    const state = {
      $disconnectedCallback: disconnectedFn,
      [disconnectedCallbackSymbol]: () => disconnectedFn(),
    };
    const stateEl = createStateElement();
    stateEl.setInitialState(state);
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    stateEl.disconnectedCallback();
    expect(disconnectedFn).toHaveBeenCalledTimes(1);
  });

  it('内包スクリプト読み込み失敗時はエラーになること', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stateEl = createStateElement();
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = 'export default { value: 1 };';
    stateEl.appendChild(script);

    const loadError = new Error('load failed');
    loadFromInnerScriptMock.mockRejectedValueOnce(loadError);
    // The loader's error is rethrown as is (not wrapped)
    await expect(stateEl.connectedCallback()).rejects.toBe(loadError);
    // #257: 同上（無言のハングではなく reject ＋ 診断 1 件）
    await expect(stateEl.connectedCallbackPromise).rejects.toBe(loadError);
    await expect(stateEl.initializePromise).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('外部モジュール（src属性の .js）の読み込み失敗も同じ着地になること', async () => {
    // #257: ソースの 4 経路（src の拡張子・json のパース・内包スクリプト・外部モジュール）は
    // どれも _loadStateFromSource の中で落ちるので、着地は 1 つ
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stateEl = createStateElement({ src: 'data.js' });
    const importError = new Error('import failed');
    loadFromScriptFileMock.mockRejectedValueOnce(importError);
    await expect(stateEl.connectedCallback()).rejects.toBe(importError);
    await expect(stateEl.connectedCallbackPromise).rejects.toBe(importError);
    await expect(stateEl.initializePromise).resolves.toBeUndefined();
    expect(stateEl.initialized).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  // README, the connectedCallbackPromise row: a root that fails to initialize rejects with the
  // original error, unwrapped. A source that cannot load is no exception: the object the loader
  // threw arrives as is, and the console logs it after a header naming the element and its source.
  describe('ソースのロード失敗はローダーのエラーそのもので reject すること', () => {
    // [label, attributes, expected console header, arrange the failure]
    const sources: Array<[string, Record<string, string>, string, (error: unknown) => (() => void) | void]> = [
      ['state属性（JSON script）', { state: 'state-data' }, '<wcs-state state="state-data">', (error) => {
        loadFromScriptJsonMock.mockImplementationOnce(() => { throw error; });
      }],
      ['src属性（.js）', { src: 'data.js' }, '<wcs-state src="data.js">', (error) => {
        loadFromScriptFileMock.mockRejectedValueOnce(error);
      }],
      // Not the real behaviour of src="*.json": the real loadFromJsonFile never rejects (it logs
      // and resolves {} — a 3.x exception the README states, pinned with the real loader in
      // integration.initFailureDiagnostics.test.ts). This mocked rejection pins only that
      // _loadStateFromSource does not wrap what a loader rejects with.
      ['src属性（.json、モックのローダーが reject した場合）', { src: 'data.json' }, '<wcs-state src="data.json">', (error) => {
        loadFromJsonFileMock.mockRejectedValueOnce(error);
      }],
      ['json属性', { json: '{broken' }, '<wcs-state>', (error) => {
        // The loader of json= is JSON.parse itself: make it throw for this attribute value only
        const originalParse = JSON.parse;
        const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: any) => {
          if (text === '{broken') throw error;
          return originalParse(text, reviver);
        });
        return () => parseSpy.mockRestore();
      }],
      ['内包スクリプト', {}, '<wcs-state>', (error) => {
        loadFromInnerScriptMock.mockRejectedValueOnce(error);
      }],
    ];

    for (const [label, attrs, header, arrange] of sources) {
      it(`${label}: connectedCallbackPromise と getBindingsReady が同一オブジェクトで reject し、診断が要素とソースと元のエラーを載せること`, async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const stateEl = createStateElement(attrs);
        if (label === '内包スクリプト') {
          const script = document.createElement('script');
          script.type = 'module';
          script.textContent = 'export default {};';
          stateEl.appendChild(script);
        }
        const host = createHostWithState(stateEl);
        const loaderError = new Error(`loader failed: ${label}`);
        const restore = arrange(loaderError);
        try {
          await expect(stateEl.connectedCallback()).rejects.toBe(loaderError);
          await expect(stateEl.connectedCallbackPromise).rejects.toBe(loaderError);
          await expect(State.getBindingsReady(host.shadowRoot!)).rejects.toBe(loaderError);
          await expect(stateEl.initializePromise).resolves.toBeUndefined();
          expect(errorSpy).toHaveBeenCalledTimes(1);
          // The context (which element, which source) is the header; the original error
          // (message, type, stack) is the same object after it
          expect(errorSpy.mock.calls[0][0]).toBe(`[@wcstack/state] ${header} failed to initialize.`);
          expect(errorSpy.mock.calls[0][1]).toBe(loaderError);
        } finally {
          restore?.();
          errorSpy.mockRestore();
        }
      });
    }

    it('state と src が両方あるときは、読む側（state）を見出しに出すこと', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const stateEl = createStateElement({ state: 'cfg', src: 'data.js' });
      createHostWithState(stateEl);
      const loaderError = new Error('state wins');
      loadFromScriptJsonMock.mockImplementationOnce(() => { throw loaderError; });
      try {
        await expect(stateEl.connectedCallback()).rejects.toBe(loaderError);
        expect(errorSpy.mock.calls[0][0]).toBe('[@wcstack/state] <wcs-state state="cfg"> failed to initialize.');
        expect(loadFromScriptFileMock).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('Error でない throw 値（文字列）も包まずにそのまま reject し、診断に載ること', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const stateEl = createStateElement({ src: 'data.js' });
      createHostWithState(stateEl);
      loadFromScriptFileMock.mockRejectedValueOnce('module threw a string');
      try {
        await expect(stateEl.connectedCallback()).rejects.toBe('module threw a string');
        await expect(stateEl.connectedCallbackPromise).rejects.toBe('module threw a string');
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]).toEqual([
          '[@wcstack/state] <wcs-state src="data.js"> failed to initialize.',
          'module threw a string',
        ]);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('src属性の拡張子エラーは包み直されず、自分の文面で 1 回だけ prefix が付くこと', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const stateEl = createStateElement({ src: 'data.txt' });
      createHostWithState(stateEl);
      try {
        const reason = await stateEl.connectedCallback().then(
          () => { throw new Error('expected a rejection'); },
          (error: unknown) => error,
        );
        expect((reason as Error).message).toBe('[@wcstack/state] Unsupported src file type: data.txt');
        await expect(stateEl.connectedCallbackPromise).rejects.toBe(reason);
        expect(errorSpy.mock.calls[0][0]).toBe('[@wcstack/state] <wcs-state src="data.txt"> failed to initialize.');
        expect(errorSpy.mock.calls[0][1]).toBe(reason);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it('setInitialStateで状態を注入できること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({ injected: true });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    const value = await getStateValue(stateEl);
    expect(value).toEqual({ injected: true });
  });

  it('初期化後にsetInitialStateを呼ぶと状態を上書きできること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({ initial: true });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    // 初期化後でもsetInitialStateで状態を上書きできる
    stateEl.setInitialState({ overwritten: true });

    const value = await getStateValue(stateEl);
    expect(value).toEqual({ overwritten: true });
  });

  it('json属性でJSON文字列を読み込めること', async () => {
    const stateEl = createStateElement({ json: '{"key":"value"}' });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    const value = await getStateValue(stateEl);
    expect(value).toEqual({ key: 'value' });
  });


  it('setInitialStateが呼ばれない場合にタイムアウト警告が出ること', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stateEl = createStateElement();
    // connectedCallbackを開始するが、setInitialStateを呼ばない
    const connectPromise = stateEl.connectedCallback();

    // _initializeBindWebComponentのawaitを解消してから_initializeに進めるため
    await Promise.resolve();

    // NO_SET_TIMEOUT (60秒) を進める
    vi.advanceTimersByTime(60 * 1000);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: No state source found')
    );

    // setInitialStateで解決させてクリーンアップ
    stateEl.setInitialState({});
    await connectPromise;

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('bind-componentの親がDocumentの場合はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    // body直下ではなく、documentFragmentに入れてparentNodeがElementでもShadowRootでもない状態にする
    const fragment = document.createDocumentFragment();
    fragment.appendChild(stateEl);
    (stateEl as any)._rootNode = document;

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /"bind-component" requires/
    );
  });

  it('plain（配線なし）の Light DOM bind-component は廃止エラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    // LightDOMの親コンポーネントをシミュレート
    if (!customElements.get('x-light-host')) {
      customElements.define('x-light-host', class extends HTMLElement {});
    }
    const host = document.createElement('x-light-host');
    host.appendChild(stateEl);
    (stateEl as any)._rootNode = document; // LightDOM: rootNodeはdocument

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /plain \(unwired\) Light DOM "bind-component" is not supported/
    );
  });

  // §2.6: 併記すると _initialize がそちらを採用し、bindWebComponent が setInitialState で
  // 渡した innerState proxy ごと捨てられて親↔子マッピングが無言で死ぬ。
  it.each([
    ['state', { 'bind-component': 'outer', state: '{}' }, /cannot be combined with state/],
    ['src', { 'bind-component': 'outer', src: './a.js' }, /cannot be combined with src/],
    ['json', { 'bind-component': 'outer', json: '{}' }, /cannot be combined with json/],
  ])('bind-componentと%s属性の併記はエラーになること', async (_label, attrs, pattern) => {
    const stateEl = createStateElement(attrs as Record<string, string>);
    createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(pattern);
  });

  it('bind-componentとinner scriptの併記はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    stateEl.appendChild(script);
    createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /cannot be combined with <script type="module">/
    );
  });

  it('bind-componentのプロパティがない場合はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /does not have property "outer"/
    );
  });

  it('bind-componentのホストがnullレジストリの場合はエラーになること', async () => {
    // null レジストリのサブツリーではホストが永久に upgrade されないため、
    // whenDefined を待つと無言でウェッジする。待たずに落とすこと。
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    Object.defineProperty(host, 'customElementRegistry', { value: null });

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /CustomElementRegistry is unavailable/
    );
  });

  it('bind-componentのプロパティがオブジェクトでない場合はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    (host as any).outer = 123;

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /is not an object/
    );
  });

  it('bind-componentで_initializeBindWebComponentがboundComponentを保持すること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const initialState = { message: 'hi' };
    (host as any).outer = initialState;

    await bindComponentLifecycleHooks.preparing!(stateEl as any)!;

    expect((stateEl as any)._boundComponent).toBe(host);
    expect((stateEl as any)._boundComponentStateProp).toBe('outer');
    // getter経由でもアクセスできることを確認
    expect(stateEl.boundComponentStateProp).toBe('outer');
  });

  it('data-wcsがある場合はbindWebComponentがstateを含めて呼ばれること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    host.setAttribute('data-wcs', 'outer:value');
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const initialState = { message: 'hi' };
    (host as any).outer = initialState;

    await bindComponentLifecycleHooks.preparing!(stateEl as any)!;

    expect(bindWebComponentMock).toHaveBeenCalledWith(stateEl, host, 'outer', initialState);
  });

  it('data-wcsがないコンポーネントでもbindWebComponentがstateを含めて呼ばれること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const initialState = { message: 'hi' };
    (host as any).outer = initialState;

    await bindComponentLifecycleHooks.preparing!(stateEl as any)!;

    // data-wcs属性がない場合もbindWebComponentがstateを含めて呼ばれる
    expect(bindWebComponentMock).toHaveBeenCalledWith(stateEl, host, 'outer', initialState);
  });

  it('data-wcsがないコンポーネントでフリーズされたstateでもbindWebComponentが呼ばれること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const frozenState = Object.freeze({
      get "user.title"() {
        return 'computed value';
      }
    });
    (host as any).outer = frozenState;

    await bindComponentLifecycleHooks.preparing!(stateEl as any)!;

    // bindWebComponentにフリーズされたstateが渡される（解凍はbindWebComponent内部で行われる）
    expect(bindWebComponentMock).toHaveBeenCalledWith(stateEl, host, 'outer', frozenState);
  });

  it('bindWebComponentが失敗した場合はエラーが伝播すること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    host.setAttribute('data-wcs', 'outer:value');
    (stateEl as any)._rootNode = stateEl.getRootNode();
    (host as any).outer = {};

    bindWebComponentMock.mockImplementationOnce(() => {
      throw new Error('bind failed');
    });

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /bind failed/
    );
  });
});

describe('plain Light DOM の廃止（v2 のゲート後）', () => {
  it('マウント先の state 要素が見つからなければ throw すること', async () => {
    const { setBindingsByNode } = await import('../src/bindings/getBindingsByNode');
    const { getPathInfo } = await import('../src/address/PathInfo');
    const stateEl = createStateElement({ 'bind-component': 'state' });
    if (!customElements.get('x-light-orphan')) {
      customElements.define('x-light-orphan', class extends HTMLElement {
        state: Record<string, any> = {};
      });
    }
    const host = document.createElement('x-light-orphan');
    host.setAttribute('data-wcs', 'state: user');
    setBindingsByNode(host, [{
      propName: 'state',
      propSegments: ['state'],
      propModifiers: [],
      statePathName: 'user',
      statePathInfo: getPathInfo('user'),
      inFilters: [],
      outFilters: [],
      bindingType: 'prop',
      uuid: null,
      node: host,
      replaceNode: host,
    } as any]);
    host.appendChild(stateEl);
    (stateEl as any)._rootNode = document;

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /No state tree found on this root/
    );
  });

  it('data-wcs はあるが state バインディングが無い Light DOM も plain として廃止エラーになること', async () => {
    const { setBindingsByNode } = await import('../src/bindings/getBindingsByNode');
    const { getPathInfo } = await import('../src/address/PathInfo');
    const stateEl = createStateElement({ 'bind-component': 'state' });
    if (!customElements.get('x-light-classonly')) {
      customElements.define('x-light-classonly', class extends HTMLElement {
        state: Record<string, any> = {};
      });
    }
    const host = document.createElement('x-light-classonly');
    host.setAttribute('data-wcs', 'class.on: flag');
    // state 以外のバインディングだけを持つ（ゲートの some が走って false になる形）
    setBindingsByNode(host, [{
      propName: 'class.on',
      propSegments: ['class', 'on'],
      propModifiers: [],
      statePathName: 'flag',
      statePathInfo: getPathInfo('flag'),
      inFilters: [],
      outFilters: [],
      bindingType: 'prop',
      uuid: null,
      node: host,
      replaceNode: host,
    } as any]);
    host.appendChild(stateEl);
    (stateEl as any)._rootNode = document;

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /plain \(unwired\) Light DOM "bind-component" is not supported/
    );
  });
});

describe('plain Light DOM の廃止（台帳が空の形）', () => {
  it('data-wcs はあるが台帳に何も無い Light DOM も plain として廃止エラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'state' });
    if (!customElements.get('x-light-noledger')) {
      customElements.define('x-light-noledger', class extends HTMLElement {
        state: Record<string, any> = {};
      });
    }
    const host = document.createElement('x-light-noledger');
    host.setAttribute('data-wcs', 'class.on: flag'); // 属性はあるが台帳未構築
    host.appendChild(stateEl);
    (stateEl as any)._rootNode = document;

    await expect(bindComponentLifecycleHooks.preparing!(stateEl as any)!).rejects.toThrow(
      /plain \(unwired\) Light DOM "bind-component" is not supported/
    );
  });
});

// 設計 §4-7「mount 属性の実行時変更 | 無視＋warn（再マウントは非目標）」。
// 初期化前の属性設定（パース時・接続前の setAttribute）は正規の使い方なので黙る。
describe('mount 属性の動的変更（設計 §4-7: 無視＋warn）', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('初期化前の mount 属性設定（正規の使い方）では warn しないこと', () => {
    const stateEl = createStateElement();
    stateEl.setAttribute('mount', 'settings');
    stateEl.setAttribute('mount', 'settings2');
    stateEl.removeAttribute('mount');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('初期化後の mount 属性変更は未サポートとして warn で知らせること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({ count: 0 });
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(warnSpy).not.toHaveBeenCalled();

    stateEl.setAttribute('mount', 'settings');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('[@wcstack/state]');
    expect(message).toMatch(/mount/);
    expect(message).toMatch(/not supported/);

    // 同値 set は変更ではないので warn を重ねない
    stateEl.setAttribute('mount', 'settings');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
