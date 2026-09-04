import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  it('name getterで現在の名前を取得できること', async () => {
    const stateEl = createStateElement();
    stateEl.setInitialState({});
    await stateEl.connectedCallback();
    expect(stateEl.name).toBe('default');
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
    const stateEl = createStateElement({ src: 'data.txt' });
    await expect(stateEl.connectedCallback()).rejects.toThrow(/Unsupported src file type/);
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
    const stateEl = createStateElement();
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = 'export default { value: 1 };';
    stateEl.appendChild(script);

    loadFromInnerScriptMock.mockRejectedValueOnce(new Error('load failed'));
    await expect(stateEl.connectedCallback()).rejects.toThrow(/Failed to initialize state/);
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(pattern);
  });

  it('bind-componentとinner scriptの併記はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    stateEl.appendChild(script);
    createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
      /cannot be combined with <script type="module">/
    );
  });

  it('bind-componentのプロパティがない場合はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
      /CustomElementRegistry is unavailable/
    );
  });

  it('bind-componentのプロパティがオブジェクトでない場合はエラーになること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    (host as any).outer = 123;

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
      /is not an object/
    );
  });

  it('bind-componentで_initializeBindWebComponentがboundComponentを保持すること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const initialState = { message: 'hi' };
    (host as any).outer = initialState;

    await (stateEl as any)._initializeBindWebComponent();

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

    await (stateEl as any)._initializeBindWebComponent();

    expect(bindWebComponentMock).toHaveBeenCalledWith(stateEl, host, 'outer', initialState);
  });

  it('data-wcsがないコンポーネントでもbindWebComponentがstateを含めて呼ばれること', async () => {
    const stateEl = createStateElement({ 'bind-component': 'outer' });
    const host = createHostWithState(stateEl);
    (stateEl as any)._rootNode = stateEl.getRootNode();
    const initialState = { message: 'hi' };
    (host as any).outer = initialState;

    await (stateEl as any)._initializeBindWebComponent();

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

    await (stateEl as any)._initializeBindWebComponent();

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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
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

    await expect((stateEl as any)._initializeBindWebComponent()).rejects.toThrow(
      /plain \(unwired\) Light DOM "bind-component" is not supported/
    );
  });
});
