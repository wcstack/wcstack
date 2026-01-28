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
vi.mock('../src/proxy/Proxy', () => ({
  createStateProxy: vi.fn((state: any) => state)
}));

import { State } from '../src/components/State';
import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { loadFromInnerScript } from '../src/stateLoader/loadFromInnerScript';
import { loadFromJsonFile } from '../src/stateLoader/loadFromJsonFile';
import { loadFromScriptFile } from '../src/stateLoader/loadFromScriptFile';
import { loadFromScriptJson } from '../src/stateLoader/loadFromScriptJson';
import { createStateProxy } from '../src/proxy/Proxy';
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

  it('初期状態でstate getterはエラーになること', () => {
    const stateEl = createStateElement();
    expect(() => stateEl.state).toThrow(/_state is not initialized yet/);
  });

  it('connectedCallbackで初期化されること（スクリプトなし）', async () => {
    const stateEl = createStateElement();
    await stateEl.connectedCallback();
    await stateEl.initializePromise;
    expect(stateEl.state).toEqual({});
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
    expect(stateEl.state).toEqual({ fromInner: true });
  });

  it('name属性変更で登録が更新されること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('name', 'default', 'foo');

    expect(getStateElementByName('foo')).toBe(stateEl);
    expect(getStateElementByName('default')).toBeNull();
  });

  it('state属性でスクリプトJSONを読み込めること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-data');

    expect(loadFromScriptJsonMock).toHaveBeenCalledWith('state-data');
    expect(stateEl.state).toEqual({ fromScriptJson: true });
  });

  it('state属性は2回目の変更でエラーになること', () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('state', '', 'state-a');
    expect(() => stateEl.attributeChangedCallback('state', 'state-a', 'state-b')).toThrow(/already been loaded/);
  });

  it('src属性でjsonを読み込めること', async () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('src', '', 'data.json');
    await new Promise((r) => setTimeout(r, 0));

    expect(loadFromJsonFileMock).toHaveBeenCalledWith('data.json');
    expect(stateEl.state).toEqual({ fromJson: true });
  });

  it('src属性でjsを読み込めること', async () => {
    const stateEl = createStateElement();
    stateEl.attributeChangedCallback('src', '', 'data.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(loadFromScriptFileMock).toHaveBeenCalledWith('data.js');
    expect(stateEl.state).toEqual({ fromScript: true });
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

  it('state getterでproxyが一度だけ作成されること', async () => {
    const stateEl = createStateElement();
    await stateEl.connectedCallback();
    const state1 = stateEl.state;
    const state2 = stateEl.state;
    expect(createStateProxyMock).toHaveBeenCalledTimes(1);
    expect(state1).toBe(state2);
  });

  it('addBindingInfoで登録とlistPathsが更新されること', () => {
    const stateEl = createStateElement();
    const bindingInfo = {
      propName: 'for',
      propSegments: ['for'],
      propModifiers: [],
      statePathName: 'items',
      statePathInfo: null,
      stateName: 'default',
      filterTexts: [],
      bindingType: 'for',
      uuid: 'uuid',
      node: document.createElement('div'),
      placeHolderNode: document.createComment('for')
    } as IBindingInfo;

    stateEl.addBindingInfo(bindingInfo);

    const list = stateEl.bindingInfosByPath.get('items') || [];
    expect(list.length).toBe(1);
    expect(stateEl.listPaths.has('items')).toBe(true);
  });
});
