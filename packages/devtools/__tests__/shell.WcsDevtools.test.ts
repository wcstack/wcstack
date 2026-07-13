import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WcsDevtools } from '../src/shell/WcsDevtools';
import { getOrCreateHookRegistry } from '../src/protocol/registry';
import {
  DEVTOOLS_HOOK_GLOBAL,
  DevtoolsEventLike,
  IAbsoluteAddressLike,
  IBindingLike,
  IDevtoolsSourceLike,
  IStateElementSummaryLike,
} from '../src/protocol/types';

if (!customElements.get('wcs-devtools')) {
  customElements.define('wcs-devtools', WcsDevtools);
}

function summaryOf(name: string, rootNode: Node): IStateElementSummaryLike {
  return {
    name,
    rootNode,
    element: {},
    paths: {
      list: new Set<string>(),
      element: new Set<string>(),
      getter: new Set<string>(),
      setter: new Set<string>(),
    },
    commandTokenNames: new Set<string>(),
    eventTokenNames: new Set<string>(),
    staticDependency: new Map(),
    dynamicDependency: new Map(),
  };
}

interface IFakeSource extends IDevtoolsSourceLike {
  sink: ((event: DevtoolsEventLike) => void) | null;
  data: Record<string, unknown>;
  emit(event: DevtoolsEventLike): void;
}

/** `items.*.name` + indexes 型の単純リゾルバ */
function resolvePath(data: Record<string, unknown>, path: string, indexes: number[] = []): unknown {
  const segments = path.split('.');
  let current: unknown = data;
  let indexCursor = 0;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    if (segment === '*') {
      current = (current as unknown[])[indexes[indexCursor++]];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function createFakeSource(
  id: string,
  summaries: IStateElementSummaryLike[],
  data: Record<string, unknown>,
  options?: { keys?: string[] | null; throwOn?: string }
): IFakeSource {
  const source: IFakeSource = {
    id,
    kind: 'state',
    packageVersion: '0.0.0',
    sink: null,
    data,
    getStateElements: () => summaries,
    keys: options?.keys === null ? (undefined as never) : () => options?.keys ?? Object.keys(data),
    read: vi.fn((name: string, rootNode: Node, path: string, indexes?: number[]) => {
      if (options?.throwOn === path) {
        throw new Error('unreadable');
      }
      return resolvePath(source.data, path, indexes);
    }) as never,
    write: vi.fn(),
    _setSink(sink) {
      source.sink = sink;
    },
    emit(event) {
      source.sink!(event);
    },
  };
  return source;
}

function addressOf(stateName: string, path: string): IAbsoluteAddressLike {
  return { absolutePathInfo: { stateName, pathInfo: { path } }, listIndex: null };
}

function bindingOf(stateName: string, path: string, node: Node): IBindingLike {
  return {
    propName: 'textContent',
    statePathName: path,
    stateName,
    bindingType: 'text',
    node,
    replaceNode: node,
  };
}

function shadowOf(devtools: WcsDevtools): ShadowRoot {
  return devtools.shadowRoot!;
}

function paneBody(devtools: WcsDevtools, pane: string): HTMLElement {
  return shadowOf(devtools).querySelector(`.pane-${pane} .pane-body`)!;
}

function headerButton(devtools: WcsDevtools, role: string): HTMLButtonElement {
  return shadowOf(devtools).querySelector(`button[data-role="${role}"]`)!;
}

describe('WcsDevtools shell', () => {
  let devtools: WcsDevtools;
  let source: IFakeSource;

  function mount(options?: {
    attrs?: Record<string, string>;
    summaries?: IStateElementSummaryLike[];
    data?: Record<string, unknown>;
    sourceOptions?: { keys?: string[] | null; throwOn?: string };
  }): void {
    const data = options?.data ?? {
      count: 5, msg: 'hello', items: [10, 20], user: { name: 'ann' },
      bare: Object.create(null) as Record<string, unknown>,
    };
    const summaries = options?.summaries ?? [summaryOf('main', document)];
    const registry = getOrCreateHookRegistry();
    source = createFakeSource('state:shelltest', summaries, data, options?.sourceOptions);
    registry.register(source);
    devtools = document.createElement('wcs-devtools') as WcsDevtools;
    for (const [name, value] of Object.entries(options?.attrs ?? {})) {
      devtools.setAttribute(name, value);
    }
    document.body.append(devtools);
    devtools.__flushRenderForTest();
  }

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-wcs-server');
  });

  afterEach(() => {
    devtools?.remove();
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
  });

  describe('起動と開閉', () => {
    it('SSRでは何も構築しないこと', () => {
      document.documentElement.setAttribute('data-wcs-server', '');
      devtools = document.createElement('wcs-devtools') as WcsDevtools;
      document.body.append(devtools);
      expect(devtools.shadowRoot).toBeNull();
      expect(devtools.core).toBeNull();
      devtools.remove(); // core null でも disconnect が安全なこと
    });

    it('接続でCoreがhookに繋がり、バッジ表示・パネル非表示で始まること', () => {
      mount();
      expect(devtools.core!.connected).toBe(true);
      const panel = shadowOf(devtools).querySelector<HTMLElement>('.panel')!;
      const badge = shadowOf(devtools).querySelector<HTMLElement>('.badge')!;
      expect(panel.hidden).toBe(true);
      expect(badge.hidden).toBe(false);
      expect(devtools.open).toBe(false);
    });

    it('バッジクリックで開き、closeボタンで閉じること', () => {
      mount();
      shadowOf(devtools).querySelector<HTMLElement>('.badge')!.click();
      expect(devtools.open).toBe(true);
      expect(shadowOf(devtools).querySelector<HTMLElement>('.panel')!.hidden).toBe(false);
      headerButton(devtools, 'close').click();
      expect(devtools.open).toBe(false);
    });

    it('open属性つきで接続すると最初から開いていること', () => {
      mount({ attrs: { open: '' } });
      expect(shadowOf(devtools).querySelector<HTMLElement>('.panel')!.hidden).toBe(false);
    });

    it('切断・再接続に耐えること（shadowは再構築しない）', () => {
      mount();
      const shadow = devtools.shadowRoot;
      devtools.remove();
      expect(devtools.core).toBeNull();
      document.body.append(devtools);
      expect(devtools.shadowRoot).toBe(shadow);
      expect(devtools.core!.connected).toBe(true);
    });

    it('rAF経由でも描画されること', async () => {
      mount();
      devtools.setAttribute('open', '');
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      expect(paneBody(devtools, 'state').textContent).toContain('count');
    });
  });

  describe('ホットキーとドック', () => {
    it('既定のAlt+Shift+Dで開閉すること', () => {
      mount();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', altKey: true, shiftKey: true }));
      expect(devtools.open).toBe(true);
      // 修飾キー不一致では反応しない
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', altKey: true }));
      expect(devtools.open).toBe(true);
    });

    it('hotkey属性の変更・無効化が効くこと', () => {
      mount({ attrs: { hotkey: 'Ctrl+K' } });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      expect(devtools.open).toBe(true);
      devtools.setAttribute('hotkey', 'none');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      expect(devtools.open).toBe(true); // 変化しない（closeされない）
      devtools.setAttribute('hotkey', 'Meta+J');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }));
      expect(devtools.open).toBe(false);
    });

    it('dockボタンでbottom/rightが切り替わること', () => {
      mount();
      const panel = shadowOf(devtools).querySelector<HTMLElement>('.panel')!;
      expect(panel.classList.contains('dock-bottom')).toBe(true);
      headerButton(devtools, 'dock').click();
      expect(devtools.getAttribute('dock')).toBe('right');
      expect(panel.classList.contains('dock-right')).toBe(true);
      headerButton(devtools, 'dock').click();
      expect(panel.classList.contains('dock-bottom')).toBe(true);
    });

    it('接続前の属性変更は無視されること', () => {
      devtools = document.createElement('wcs-devtools') as WcsDevtools;
      expect(() => devtools.setAttribute('dock', 'right')).not.toThrow();
      expect(() => devtools.__flushRenderForTest()).not.toThrow();
    });
  });

  describe('Stateペイン', () => {
    it('トップレベルキーと値を描画すること', () => {
      mount();
      devtools.setAttribute('open', '');
      devtools.__flushRenderForTest();
      const text = paneBody(devtools, 'state').textContent!;
      expect(text).toContain('count:');
      expect(text).toContain('5');
      expect(text).toContain('msg:');
      expect(text).toContain('"hello"');
    });

    it('roster空・keys空のメッセージを出すこと', () => {
      mount({ summaries: [] });
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'state').textContent).toContain('no <wcs-state> elements');

      devtools.remove();
      delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
      mount({ sourceOptions: { keys: [] } });
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'state').textContent).toContain('no readable keys');
    });

    it('配列・オブジェクトを展開・折りたたみできること', () => {
      mount();
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'state');
      const rowOf = (label: string): HTMLElement =>
        [...body.querySelectorAll<HTMLElement>('.tree-row')].find(
          (row) => row.querySelector('.key')!.textContent === `${label}:`
        )!;

      rowOf('items').querySelector<HTMLElement>('.toggle')!.click();
      devtools.__flushRenderForTest();
      expect(body.textContent).toContain('[0]:');
      expect(body.textContent).toContain('[1]:');

      rowOf('user').querySelector<HTMLElement>('.toggle')!.click();
      devtools.__flushRenderForTest();
      expect(body.textContent).toContain('name:');

      // 折りたたみ
      rowOf('items').querySelector<HTMLElement>('.toggle')!.click();
      devtools.__flushRenderForTest();
      expect(body.textContent).not.toContain('[0]:');
    });

    it('巨大リストは20件+件数表示で打ち切ること', () => {
      const big = Array.from({ length: 25 }, (_, index) => index);
      mount({ data: { big } });
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'state');
      body.querySelector<HTMLElement>('.tree-row .toggle')!.click();
      devtools.__flushRenderForTest();
      expect(body.textContent).toContain('[19]:');
      expect(body.textContent).not.toContain('[20]:');
      expect(body.textContent).toContain('…(25 items)');
    });

    it('読めないgetterを表示だけ行うこと', () => {
      mount({ data: { broken: 1, ok: 2 }, sourceOptions: { throwOn: 'broken' } });
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'state').textContent).toContain('(unreadable getter)');
    });

    it('primitive編集がwriteに流れること（JSON/string/Escape）', () => {
      mount();
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'state');
      const valueSpanOf = (label: string): HTMLElement =>
        [...body.querySelectorAll<HTMLElement>('.tree-row')]
          .find((row) => row.querySelector('.key')!.textContent === `${label}:`)!
          .querySelector<HTMLElement>('.value')!;

      // number → JSON.parse で数値
      valueSpanOf('count').click();
      let input = body.querySelector<HTMLInputElement>('input')!;
      input.value = '9';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(source.write).toHaveBeenCalledWith('main', document, 'count', 9, []);

      // JSON にならない文字列はそのまま
      devtools.__flushRenderForTest();
      valueSpanOf('msg').click();
      input = body.querySelector<HTMLInputElement>('input')!;
      input.value = 'world';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(source.write).toHaveBeenCalledWith('main', document, 'msg', 'world', []);

      // Escape は書き込まない
      devtools.__flushRenderForTest();
      const callCount = (source.write as ReturnType<typeof vi.fn>).mock.calls.length;
      valueSpanOf('count').click();
      input = body.querySelector<HTMLInputElement>('input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect((source.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });

    it('state選択の切り替えができること', () => {
      const rootA = document.createElement('div');
      const rootB = document.createElement('div');
      mount({
        summaries: [summaryOf('alpha', rootA), summaryOf('beta', rootB)],
        data: { count: 1 },
      });
      devtools.__flushRenderForTest();
      const select = shadowOf(devtools).querySelector<HTMLSelectElement>('select')!;
      expect(select.options.length).toBe(2);
      select.value = 'state:shelltest:beta';
      select.dispatchEvent(new Event('change'));
      devtools.__flushRenderForTest();
      expect(select.value).toBe('state:shelltest:beta');

      // 空値の change は「未選択」扱いで先頭にフォールバックする
      select.value = '';
      select.dispatchEvent(new Event('change'));
      devtools.__flushRenderForTest();
      expect(select.value).toBe('state:shelltest:alpha');
    });
  });

  describe('Wiringペイン', () => {
    it('ライブ配線が無ければdeclaredスキャンへフォールバックすること', () => {
      document.body.innerHTML = '<span data-wcs="textContent: count"></span>';
      mount();
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'wiring');
      expect(body.textContent).toContain('declared');
      expect(body.textContent).toContain('count@default');
      // declared 行クリックでハイライト（要素は接続済み）
      const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
      body.querySelector<HTMLElement>('.notice button')!.click();
      expect(reloadSpy).toHaveBeenCalled();
      reloadSpy.mockRestore();
      body.querySelector<HTMLElement>('.wiring-row')!.click();
      expect(shadowOf(devtools).querySelectorAll('.hl-box').length).toBeGreaterThan(0);
    });

    it('declaredも無い場合は空メッセージになること', () => {
      mount();
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'wiring').textContent).toContain('no bindings observed');
    });

    it('ライブ配線を描画し、行クリックでハイライトされること', () => {
      const bound = document.createElement('span');
      document.body.append(bound);
      mount();
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count', bound) });
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'wiring');
      expect(body.textContent).toContain('1 live binding');
      expect(body.textContent).toContain('count@main');
      body.querySelector<HTMLElement>('.wiring-row')!.click();
      expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(1);
    });

    it('stateペインのパスクリックでパス文脈+ハイライトになること', () => {
      const bound = document.createElement('span');
      document.body.append(bound);
      mount();
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count', bound) });
      devtools.__flushRenderForTest();
      const stateBody = paneBody(devtools, 'state');
      const countKey = [...stateBody.querySelectorAll<HTMLElement>('.key')]
        .find((key) => key.textContent === 'count:')!;
      countKey.click();
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'wiring').textContent).toContain('context: count');
      expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(1);
    });

    it('pickモードでページ要素を選択できること', () => {
      const target = document.createElement('button');
      document.body.append(target);
      const bound = document.createElement('span');
      target.append(bound);
      mount();
      source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: bindingOf('main', 'count', bound) });
      devtools.__flushRenderForTest();

      const pick = headerButton(devtools, 'pick');
      pick.click();
      expect(pick.getAttribute('aria-pressed')).toBe('true');
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      devtools.__flushRenderForTest();
      expect(pick.getAttribute('aria-pressed')).toBe('false');
      const wiringText = paneBody(devtools, 'wiring').textContent!;
      expect(wiringText).toContain('context: <button>');
      expect(wiringText).toContain('1 live binding');

      // トグルで開始→即解除の経路
      pick.click();
      expect(pick.getAttribute('aria-pressed')).toBe('true');
      pick.click();
      expect(pick.getAttribute('aria-pressed')).toBe('false');
    });

    it('pickモード中もdevtools自身は選択対象外なこと', () => {
      mount();
      const pick = headerButton(devtools, 'pick');
      pick.click();
      // ホスト要素そのものへの click（実ブラウザの retarget 相当）は無視される
      devtools.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(pick.getAttribute('aria-pressed')).toBe('true');
      pick.click(); // 後始末
    });

    it('テキストノードのpickはnodeNameを文脈表示すること', () => {
      mount();
      const holder = document.createElement('p');
      const text = document.createTextNode('plain');
      holder.append(text);
      document.body.append(holder);
      headerButton(devtools, 'pick').click();
      text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'wiring').textContent).toContain('context: #text');
    });

    it('パス文脈選択中にrosterが消えても安全なこと', () => {
      mount();
      devtools.__flushRenderForTest();
      const countKey = [...paneBody(devtools, 'state').querySelectorAll<HTMLElement>('.key')]
        .find((key) => key.textContent === 'count:')!;
      countKey.click();
      // roster を空にして wiring を再描画
      (source.getStateElements as unknown as { mockReturnValue?: never });
      (source as unknown as { getStateElements: () => never[] }).getStateElements = () => [];
      devtools.core!.refreshRoster();
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'wiring').textContent).toContain('context: count');
      expect(paneBody(devtools, 'wiring').textContent).toContain('0 live bindings');
    });
  });

  describe('Timelineペイン', () => {
    function emitWrite(path: string): void {
      source.emit({
        type: 'state:write',
        absoluteAddress: addressOf('main', path),
        value: 1,
        oldValue: undefined,
        hasOldValue: false,
      });
    }

    it('イベント行を描画し、空撃ちtokenに警告を付けること', () => {
      mount();
      emitWrite('count');
      source.emit({ type: 'state:token-emit', kind: 'command', stateName: 'main', tokenName: 'orphan', args: [1], subscriberCount: 0 });
      // stateName なしの行（batch）も混ぜる
      source.emit({ type: 'state:update-batch', addresses: new Set([addressOf('main', 'count')]) });
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'timeline');
      expect(body.textContent).toContain('count@main');
      expect(body.textContent).toContain('orphan');
      expect(body.textContent).toContain('1 address');
      expect(body.querySelectorAll('.badge-tag.warn')).toHaveLength(1);
    });

    it('切断後のpause/clearボタンは何もしないこと', () => {
      mount();
      devtools.remove();
      expect(devtools.core).toBeNull();
      expect(() => headerButton(devtools, 'pause').click()).not.toThrow();
      expect(() => headerButton(devtools, 'clear').click()).not.toThrow();
    });

    it('活動が無ければ空メッセージになること', () => {
      mount();
      devtools.__flushRenderForTest();
      expect(paneBody(devtools, 'timeline').textContent).toContain('no activity yet');
    });

    it('描画上限を超えた分は省略行にまとめること', () => {
      mount({ attrs: { buffer: '1000' } });
      for (let index = 0; index < 205; index++) {
        emitWrite(`p${index}`);
      }
      devtools.__flushRenderForTest();
      const body = paneBody(devtools, 'timeline');
      expect(body.textContent).toContain('…(5 earlier entries)');
      expect(body.querySelectorAll('.timeline-row')).toHaveLength(200);
    });

    it('pause/clearボタンが機能すること', () => {
      mount();
      const pause = headerButton(devtools, 'pause');
      pause.click();
      expect(devtools.core!.paused).toBe(true);
      expect(pause.getAttribute('aria-pressed')).toBe('true');
      emitWrite('ignored');
      expect(devtools.core!.getTimeline()).toHaveLength(0);
      pause.click();
      emitWrite('recorded');
      expect(devtools.core!.getTimeline()).toHaveLength(1);
      headerButton(devtools, 'clear').click();
      expect(devtools.core!.getTimeline()).toHaveLength(0);
    });

    it('buffer属性とhidden-states属性がCoreへ渡ること', () => {
      const rootNode = document.createElement('div');
      mount({
        attrs: { buffer: '2', 'hidden-states': 'secret, ' },
        summaries: [summaryOf('main', rootNode), summaryOf('secret', rootNode)],
      });
      expect(devtools.core!.getRoster().map((entry) => entry.name)).toEqual(['main']);
      for (const path of ['a', 'b', 'c']) {
        emitWrite(path);
      }
      expect(devtools.core!.getTimeline()).toHaveLength(2);
    });

    it('不正なbuffer属性は既定値になること', () => {
      mount({ attrs: { buffer: 'abc' } });
      expect(devtools.core).not.toBeNull();
      emitWrite('x');
      expect(devtools.core!.getTimeline()).toHaveLength(1);
    });
  });

  describe('ハイライト', () => {
    it('重複要素・未接続ノード・親なしテキストをスキップし、時間経過で消えること', () => {
      vi.useFakeTimers();
      try {
        const connected = document.createElement('span');
        document.body.append(connected);
        const detached = document.createElement('span');
        const orphanText = document.createTextNode('orphan');
        const textInConnected = document.createTextNode('t');
        connected.append(textInConnected);

        mount();
        // node と replaceNode が同一要素に解決される binding → box は 1 個
        const binding: IBindingLike = {
          propName: 'textContent',
          statePathName: 'count',
          stateName: 'main',
          bindingType: 'text',
          node: textInConnected,
          replaceNode: connected,
        };
        source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding });
        const detachedBinding = bindingOf('main', 'count', detached);
        source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: detachedBinding });
        const orphanBinding = bindingOf('main', 'count', orphanText);
        source.emit({ type: 'state:binding-added', absoluteAddress: addressOf('main', 'count'), binding: orphanBinding });
        devtools.__flushRenderForTest();

        const rows = paneBody(devtools, 'wiring').querySelectorAll<HTMLElement>('.wiring-row');
        expect(rows).toHaveLength(3);
        rows[0].click();
        expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(1);
        rows[1].click(); // 未接続 → 0
        expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(0);
        rows[2].click(); // 親なしテキスト → 0
        expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(0);

        rows[0].click();
        expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(1);
        vi.advanceTimersByTime(2000);
        expect(shadowOf(devtools).querySelectorAll('.hl-box')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
