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
  createStateProxy: vi.fn((state: any) => state)
}));

import { State } from '../src/components/State';
import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { loadFromInnerScript } from '../src/stateLoader/loadFromInnerScript';
import { loadFromJsonFile } from '../src/stateLoader/loadFromJsonFile';
import { loadFromScriptFile } from '../src/stateLoader/loadFromScriptFile';
import { loadFromScriptJson } from '../src/stateLoader/loadFromScriptJson';
import { createStateProxy } from '../src/proxy/StateHandler';
import { getPathInfo } from '../src/address/PathInfo';
import type { IBindingInfo } from '../src/types';

const loadFromInnerScriptMock = vi.mocked(loadFromInnerScript);
const loadFromJsonFileMock = vi.mocked(loadFromJsonFile);
const loadFromScriptFileMock = vi.mocked(loadFromScriptFile);
const loadFromScriptJsonMock = vi.mocked(loadFromScriptJson);
const createStateProxyMock = vi.mocked(createStateProxy);

const STATE_TAG = 'wcs-state-test';
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

const createStateElement = (): State => document.createElement(STATE_TAG) as State;

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
  stateName: 'default',
  filters: [],
  bindingType: 'prop',
  uuid: null,
  node: document.createElement('input'),
  replaceNode: document.createElement('input'),
  ...overrides,
} as IBindingInfo);

describe('State component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setStateElementByName('default', null);
    setStateElementByName('foo', null);
    createStateProxyMock.mockImplementation((state: any) => state);
    loadFromInnerScriptMock.mockResolvedValue({ fromInner: true });
    loadFromJsonFileMock.mockResolvedValue({ fromJson: true });
    loadFromScriptFileMock.mockResolvedValue({ fromScript: true });
    loadFromScriptJsonMock.mockReturnValue({ fromScriptJson: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('初期状態でcreateStateがエラーになること', () => {
    const stateEl = createStateElement();
    expect(() => stateEl.createState('readonly', () => {})).toThrow(/_state is not initialized yet/);
  });

  it('connectedCallbackで初期化されること（スクリプトなし）', async () => {
    const stateEl = createStateElement();
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    const value = await getStateValue(stateEl);
    expect(value).toEqual({});
  });

  it('connectedCallbackは2回目以降何もしないこと', async () => {
    const stateEl = createStateElement();
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

  it('name属性変更で登録が更新されること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('name', 'default', 'foo');

    expect(getStateElementByName('foo')).toBe(stateEl);
    expect(getStateElementByName('default')).toBeNull();
  });

  it('name getterで現在の名前を取得できること', () => {
    const stateEl = createStateElement();
    expect(stateEl.name).toBe('default');
  });

  it('state属性でスクリプトJSONを読み込めること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-data');

    expect(loadFromScriptJsonMock).toHaveBeenCalledWith('state-data');
    return expect(getStateValue(stateEl)).resolves.toEqual({ fromScriptJson: true });
  });

  it('state属性が設定済みの場合はinitializeで読み込みをスキップすること', async () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-data');
    await stateEl.connectedCallback();
    await stateEl.initializePromise;

    expect(loadFromInnerScriptMock).not.toHaveBeenCalled();
  });

  it('state属性は2回目の変更でエラーになること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-a');
    expect(() => stateEl.attributeChangedCallback('state', 'state-a', 'state-b')).toThrow(/already been loaded/);
  });

  it('src属性はロード済みの場合エラーになること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-a');
    expect(() => stateEl.attributeChangedCallback('src', '', 'data.json')).toThrow(/already been loaded/);
  });

  it('src属性でjsonを読み込めること', async () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('src', '', 'data.json');
    await new Promise((r) => setTimeout(r, 0));

    expect(loadFromJsonFileMock).toHaveBeenCalledWith('data.json');
    const value = await getStateValue(stateEl);
    expect(value).toEqual({ fromJson: true });
  });

  it('src属性でjsを読み込めること', async () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('src', '', 'data.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(loadFromScriptFileMock).toHaveBeenCalledWith('data.js');
    const value = await getStateValue(stateEl);
    expect(value).toEqual({ fromScript: true });
  });

  it('src属性の拡張子が不正な場合はエラーになること', () => {
    const stateEl = createStateElement();
    expect(() => stateEl.attributeChangedCallback('src', '', 'data.txt')).toThrow(/Unsupported src file type/);
  });

  it('srcロード中は変更できないこと', () => {
    const stateEl = createStateElement();
    loadFromJsonFileMock.mockImplementation(() => new Promise(() => {}));
    stateEl.attributeChangedCallback('src', '', 'data.json');
    expect(() => stateEl.attributeChangedCallback('src', 'data.json', 'data2.json')).toThrow(/currently loading/);
  });

  it('state属性はロード中に変更できないこと', () => {
    const stateEl = createStateElement();
    loadFromJsonFileMock.mockImplementation(() => new Promise(() => {}));
    stateEl.attributeChangedCallback('src', '', 'data.json');
    expect(() => stateEl.attributeChangedCallback('state', '', 'state-data')).toThrow(/currently loading/);
  });

  it('createState呼び出しごとにproxyが作成されること', async () => {
    const stateEl = createStateElement();
    await stateEl.connectedCallback();
    const state1 = await getStateValue(stateEl);
    const state2 = await getStateValue(stateEl);
    expect(createStateProxyMock).toHaveBeenCalledTimes(2);
    expect(state1).toBe(state2);
  });

  it('getterを持つstateはgetterPathsに追加されること', () => {
    const stateEl = createStateElement();
    loadFromScriptJsonMock.mockReturnValue({
      get computed() {
        return 1;
      }
    });

    stateEl.attributeChangedCallback('state', '', 'state-data');
    expect(stateEl.getterPaths.has('computed')).toBe(true);
  });

  it('setterを持つstateはsetterPathsに追加されること', () => {
    const stateEl = createStateElement();
    let _value = 0;
    loadFromScriptJsonMock.mockReturnValue({
      get value() {
        return _value;
      },
      set value(v: number) {
        _value = v;
      }
    });

    stateEl.attributeChangedCallback('state', '', 'state-data');
    expect(stateEl.setterPaths.has('value')).toBe(true);
  });

  it('createStateAsyncで非同期コールバックを実行できること', async () => {
    const stateEl = createStateElement();
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
    await stateEl.connectedCallback();

    expect(stateEl.initializePromise).toBeInstanceOf(Promise);
    expect(stateEl.listPaths).toBeInstanceOf(Set);
    expect(stateEl.elementPaths).toBeInstanceOf(Set);
    expect(stateEl.getterPaths).toBeInstanceOf(Set);
    expect(stateEl.setterPaths).toBeInstanceOf(Set);
    expect(stateEl.loopContextStack).toBeDefined();
    expect(stateEl.cache).toBeInstanceOf(Map);
    expect(stateEl.mightChangeByPath).toBeInstanceOf(Map);
    expect(stateEl.dynamicDependency).toBeInstanceOf(Map);
    expect(stateEl.staticDependency).toBeInstanceOf(Map);
    expect(stateEl.version).toBe(0);
  });

  it('setBindingInfoでlistPathsが更新されること', () => {
    const stateEl = createStateElement();
    const bindingInfo = {
      propName: 'for',
      propSegments: ['for'],
      propModifiers: [],
      statePathName: 'items',
      statePathInfo: getPathInfo('items'),
      stateName: 'default',
      filters: [],
      bindingType: 'for',
      uuid: 'uuid',
      node: document.createElement('div'),
      replaceNode: document.createComment('for')
    } as IBindingInfo;

    stateEl.setBindingInfo(bindingInfo);

    expect(stateEl.listPaths.has('items')).toBe(true);
    expect(stateEl.elementPaths.has('items.*')).toBe(true);
  });

  it('setBindingInfoの再登録で静的依存が重複しないこと', () => {
    const stateEl = createStateElement();
    const bindingInfo = createBindingInfo({
      statePathName: 'user.name',
      statePathInfo: getPathInfo('user.name'),
    });

    stateEl.setBindingInfo(bindingInfo);
    stateEl.setBindingInfo(bindingInfo);

    const deps = stateEl.staticDependency.get('user') || [];
    expect(deps).toEqual(['user.name']);
  });

  it('setBindingInfoで親パスの静的依存が登録されること', () => {
    const stateEl = createStateElement();
    const bindingInfo = createBindingInfo({
      statePathName: 'user.name',
      statePathInfo: getPathInfo('user.name'),
    });

    stateEl.setBindingInfo(bindingInfo);

    const deps = stateEl.staticDependency.get('user') || [];
    expect(deps).toContain('user.name');
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

  it('disconnectedCallbackで登録が解除されること', () => {
    const stateEl = createStateElement();
    setStateElementByName('default', stateEl);
    stateEl.disconnectedCallback();
    expect(getStateElementByName('default')).toBeNull();
  });

  it('内包スクリプト読み込み失敗時はエラーになること', async () => {
    const stateEl = createStateElement();
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = 'export default { value: 1 };';
    stateEl.appendChild(script);

    loadFromInnerScriptMock.mockRejectedValueOnce(new Error('load failed'));
    await expect(stateEl.connectedCallback()).rejects.toThrow(/Failed to load state from inner script/);
  });
});
