import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installDccHooks } from "../src/dcc/addressHooks";
import { installDccLifecycle } from "../src/dcc/dccLifecycle";

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
// bootstrapState() を経ないので、DCC の接続を引き取る機能を自分で install する（分割エントリのページと同じ）
installDccLifecycle();

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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loadError = new Error('load error');
    loadFromInnerScriptMock.mockRejectedValueOnce(loadError);
    const { stateEl } = createDCCSetup({}, '<script type="module">export default {}</script>');

    try {
      // The loader's error is not wrapped (the same rule as the root's _loadStateFromSource)
      await expect((stateEl as any).connectedCallback()).rejects.toBe(loadError);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // README, the connectedCallbackPromise row: a DCC load failure also rejects with the original error
  describe('DCCのロード失敗はローダーのエラーそのもので reject すること', () => {
    // [label, attributes, content, expected console header, arrange the failure]
    const sources: Array<[string, Record<string, string>, string | undefined, string, (error: unknown) => void]> = [
      ['内包スクリプト', {}, '<script type="module">export default {}</script>', '<wcs-state>', (error) => {
        loadFromInnerScriptMock.mockRejectedValueOnce(error);
      }],
      ['src属性（.js）', { src: 'component.js' }, undefined, '<wcs-state src="component.js">', (error) => {
        loadFromScriptFileMock.mockRejectedValueOnce(error);
      }],
    ];

    for (const [label, attrs, content, header, arrange] of sources) {
      it(`${label}: connectedCallbackPromise と getBindingsReady が同一オブジェクトで reject し、診断が要素とソースと元のエラーを載せること`, async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { host, stateEl } = createDCCSetup(attrs, content);
        const loaderError = new Error(`dcc loader failed: ${label}`);
        arrange(loaderError);
        try {
          await expect((stateEl as any).connectedCallback()).rejects.toBe(loaderError);
          await expect(stateEl.connectedCallbackPromise).rejects.toBe(loaderError);
          // The definition's shadow root has no tree: its bindings-ready reports the same failure
          await expect(State.getBindingsReady(host.shadowRoot!)).rejects.toBe(loaderError);
          await expect(stateEl.initializePromise).resolves.toBeUndefined();
          expect(defineDCCMock).not.toHaveBeenCalled();
          expect(errorSpy).toHaveBeenCalledTimes(1);
          expect(errorSpy.mock.calls[0][0]).toBe(`[@wcstack/state] ${header} failed to initialize.`);
          expect(errorSpy.mock.calls[0][1]).toBe(loaderError);
        } finally {
          errorSpy.mockRestore();
        }
      });
    }

    it('Error でない throw 値（文字列）も包まずにそのまま reject すること', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { stateEl } = createDCCSetup({ src: 'component.js' });
      loadFromScriptFileMock.mockRejectedValueOnce('module threw a string');
      try {
        await expect((stateEl as any).connectedCallback()).rejects.toBe('module threw a string');
        await expect(stateEl.connectedCallbackPromise).rejects.toBe('module threw a string');
        expect(errorSpy.mock.calls[0]).toEqual([
          '[@wcstack/state] <wcs-state src="component.js"> failed to initialize.',
          'module threw a string',
        ]);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('DCC 自身の設定エラーは二重 prefix の包みを付けずに自分の文面で reject すること', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { stateEl } = createDCCSetup({ src: 'component.json' });
      try {
        // Was: "[@wcstack/state] DCC: Failed to load state: Error: [@wcstack/state] DCC: Unsupported src type: …"
        await expect((stateEl as any).connectedCallback()).rejects.toThrow(
          /^\[@wcstack\/state\] DCC: Unsupported src type: component\.json$/,
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  // §3.1: DCC の state はテンプレートに属しインスタンスごとにロードされるので、
  // 定義時点のホストのプロパティをソースにする bind-component とは両立しない。
  // 従来は DCC 分岐の return で無言に無視していた。
  it('DCC定義内のbind-componentはエラーになること', async () => {
    const { stateEl } = createDCCSetup(
      { 'bind-component': 'state' },
      '<script type="module">export default {}</script>',
    );

    await expect((stateEl as any).connectedCallback())
      .rejects.toThrow(/"bind-component" cannot be used inside a \[data-wc-definition\] host/);
    expect(defineDCCMock).not.toHaveBeenCalled();
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
      installDccHooks();
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setBindableEventMap({ count: 'x-el:count-changed' });
      expect(stateEl.bindableEventMap).toEqual({ count: 'x-el:count-changed' });
    });
  });
});
