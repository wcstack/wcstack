import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/stateLoader/loadFromInnerScript', () => ({
  loadFromInnerScript: vi.fn().mockResolvedValue({ count: 0, $bindables: ['count'] })
}));
vi.mock('../src/stateLoader/loadFromScriptFile', () => ({
  loadFromScriptFile: vi.fn().mockResolvedValue({ value: 'test' })
}));
vi.mock('../src/dcc/defineDCC', () => ({
  defineDCC: vi.fn()
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
import { loadFromInnerScript } from '../src/stateLoader/loadFromInnerScript';
import { loadFromScriptFile } from '../src/stateLoader/loadFromScriptFile';
import { defineDCC } from '../src/dcc/defineDCC';

const loadFromInnerScriptMock = vi.mocked(loadFromInnerScript);
const loadFromScriptFileMock = vi.mocked(loadFromScriptFile);
const defineDCCMock = vi.mocked(defineDCC);

const STATE_TAG = 'wcs-state-dcc-test';
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

function createDCCSetup(stateAttrs?: Record<string, string>, stateContent?: string): {
  host: HTMLElement;
  stateEl: State;
} {
  const host = document.createElement('x-dcc-host');
  host.setAttribute('data-wc-definition', '');
  const shadow = host.attachShadow({ mode: 'open' });

  const stateEl = document.createElement(STATE_TAG) as State;
  if (stateAttrs) {
    for (const [key, value] of Object.entries(stateAttrs)) {
      stateEl.setAttribute(key, value);
    }
  }
  if (stateContent) {
    stateEl.innerHTML = stateContent;
  }
  shadow.appendChild(stateEl);
  return { host, stateEl };
}

describe('State DCC検出', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ShadowRoot内かつdata-wc-definitionがある場合はDCC定義が呼ばれること', async () => {
    const { host, stateEl } = createDCCSetup({}, '<script type="module">export default {}</script>');
    // connectedCallbackを直接呼ぶ（DOMに追加する代わりに）
    await (stateEl as any).connectedCallback();

    expect(defineDCCMock).toHaveBeenCalledTimes(1);
    expect(defineDCCMock).toHaveBeenCalledWith(host, expect.any(Object), expect.any(Object));
    expect(loadFromInnerScriptMock).toHaveBeenCalled();
  });

  it('src属性が.jsの場合はloadFromScriptFileが呼ばれること', async () => {
    const { host, stateEl } = createDCCSetup({ src: 'component.js' });
    await (stateEl as any).connectedCallback();

    expect(loadFromScriptFileMock).toHaveBeenCalledWith('component.js');
    expect(defineDCCMock).toHaveBeenCalledTimes(1);
  });

  it('src属性が.js以外の場合はエラーになること', async () => {
    const { stateEl } = createDCCSetup({ src: 'component.json' });

    await expect((stateEl as any).connectedCallback()).rejects.toThrow(/DCC/);
  });

  it('script要素もsrc属性もない場合はエラーになること', async () => {
    const { stateEl } = createDCCSetup({});

    await expect((stateEl as any).connectedCallback()).rejects.toThrow(/DCC/);
  });

  it('loadFromInnerScriptが失敗した場合はエラーになること', async () => {
    loadFromInnerScriptMock.mockRejectedValueOnce(new Error('load error'));
    const { stateEl } = createDCCSetup({}, '<script type="module">export default {}</script>');

    await expect((stateEl as any).connectedCallback()).rejects.toThrow(/DCC/);
  });

  it('DCC検出後にinitializePromiseとconnectedCallbackPromiseが解決されること', async () => {
    const { stateEl } = createDCCSetup({}, '<script type="module">export default {}</script>');
    await (stateEl as any).connectedCallback();

    await expect(stateEl.initializePromise).resolves.toBeUndefined();
    await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
  });

  describe('bindableEventMap', () => {
    it('初期状態は空オブジェクトであること', () => {
      const stateEl = document.createElement(STATE_TAG) as State;
      expect(stateEl.bindableEventMap).toEqual({});
    });

    it('setBindableEventMapで設定できること', () => {
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setBindableEventMap({ count: 'x-el:count-changed' });
      expect(stateEl.bindableEventMap).toEqual({ count: 'x-el:count-changed' });
    });
  });
});
