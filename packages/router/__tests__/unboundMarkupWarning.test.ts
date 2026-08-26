import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './setup';
import { warnUnboundMarkup, _resetUnboundMarkupWarnings } from '../src/unboundMarkupWarning';
import { bindSubtree, wasBoundBy, flushPendingBinds, getBinder } from '../src/protocol/binder';

// 後から DOM に差し込まれたノードのバインドは効かない（state はバインド構築時に
// document に居たノードしか走査しない）。挙動は変えず、「黙って空になる」を
// 「原因を指す警告」に変えるのがこのモジュールの役割。
describe('warnUnboundMarkup', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const created: Element[] = [];

  const make = (html: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const element = host.firstElementChild as Element;
    created.push(element);
    return element;
  };

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    _resetUnboundMarkupWarnings(created);
    created.length = 0;
    vi.restoreAllMocks();
  });

  it('data-wcs を持つ要素自身を報告すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: title"></h2>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('here');
    expect(warn.mock.calls[0][0]).toContain('do that');
  });

  it('子孫の data-wcs も報告すること', () => {
    warnUnboundMarkup(make('<section><p><span data-wcs="textContent: x"></span></p></section>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('バインドが無ければ黙っていること', () => {
    warnUnboundMarkup(make('<section><p>static text</p></section>'), 'here', 'do that');
    expect(warn).not.toHaveBeenCalled();
  });

  it('同じ要素では 1 回しか報告しないこと', () => {
    const element = make('<h2 data-wcs="textContent: title"></h2>');
    warnUnboundMarkup(element, 'here', 'do that');
    warnUnboundMarkup(element, 'here', 'do that');
    warnUnboundMarkup(element, 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('要素ごとに独立して報告すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: a"></h2>'), 'here', 'do that');
    warnUnboundMarkup(make('<h2 data-wcs="textContent: b"></h2>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('原因（バインド構築の時点）に言及すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: title"></h2>'), 'here', 'do that');
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('[@wcstack/router]');
    expect(message).toContain('built its');
    expect(message).toContain('render empty');
  });
});

// 警告は「binder が居ないページ」でだけ出るべきで、居るページでは出してはいけない。
// 誤検出は利用者に警告そのものを無視させるので、機能を失うのと同じである。
describe('binder が居るときは警告しない', () => {
  const globals = globalThis as Record<symbol, unknown>;
  const BINDER_KEY = Symbol.for('wcstack.binder');
  let warn: ReturnType<typeof vi.spyOn>;
  const created: Element[] = [];

  const make = (html: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const element = host.firstElementChild as Element;
    document.body.appendChild(host);
    created.push(element);
    return element;
  };

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete globals[BINDER_KEY];
    delete globals[Symbol.for('wcstack.binder.pending')];
    delete globals[Symbol.for('wcstack.binder.taken')];
    _resetUnboundMarkupWarnings(created);
    created.forEach((el) => el.parentElement?.remove());
    created.length = 0;
    vi.restoreAllMocks();
  });

  it('binder が引き取ったら報告しないこと', async () => {
    globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 1, bind: () => undefined };
    const element = make('<h2 data-wcs="textContent: title"></h2>');

    expect(bindSubtree(element)).toBe(true);
    expect(wasBoundBy(element)).toBe(true);

    warnUnboundMarkup(element, 'here', 'do that');
    await new Promise((r) => setTimeout(r, 5));
    expect(warn).not.toHaveBeenCalled();
  });

  it('binder が居ないなら報告すること', async () => {
    const element = make('<h2 data-wcs="textContent: title"></h2>');
    expect(bindSubtree(element)).toBe(false);

    warnUnboundMarkup(element, 'here', 'do that');
    await new Promise((r) => setTimeout(r, 5));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// プロトコルはパッケージごとに複製されるので、router が配るコピーも router 側で
// 覆う必要がある。`flushPendingBinds` を呼ぶのは state だけだが、**router のバンドルに
// 載って配られる以上**、そのコードが壊れていないことは router のテストが保証する。
describe('protocol/binder — router に載るコピー', () => {
  const globals = globalThis as Record<symbol, unknown>;
  const BINDER_KEY = Symbol.for('wcstack.binder');

  afterEach(() => {
    delete globals[BINDER_KEY];
    delete globals[Symbol.for('wcstack.binder.pending')];
    delete globals[Symbol.for('wcstack.binder.taken')];
  });

  it('binder が居なければ引き取りは何もしないこと', () => {
    bindSubtree(document.createElement('div'));
    expect(() => flushPendingBinds()).not.toThrow();
  });

  it('キューが空なら何もしないこと', () => {
    globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 1, bind: () => undefined };
    expect(() => flushPendingBinds()).not.toThrow();
  });

  it('預かった分を binder へ渡し、taken に記録すること', () => {
    const taken: Node[] = [];
    const first = document.createElement('div');
    const second = document.createElement('span');
    bindSubtree(first);
    bindSubtree(second);

    globals[BINDER_KEY] = {
      protocol: 'wcs-binder',
      version: 1,
      bind: (subtree: Node) => { taken.push(subtree); },
    };
    flushPendingBinds();

    expect(taken).toEqual([first, second]);
    expect(wasBoundBy(first)).toBe(true);
    expect(wasBoundBy(second)).toBe(true);
  });

  it('引き取りは一度きりであること', () => {
    const taken: Node[] = [];
    bindSubtree(document.createElement('div'));
    globals[BINDER_KEY] = {
      protocol: 'wcs-binder',
      version: 1,
      bind: (subtree: Node) => { taken.push(subtree); },
    };
    flushPendingBinds();
    flushPendingBinds();
    expect(taken).toHaveLength(1);
  });
});

describe('protocol/binder — 不正な binder は採らない（router コピー）', () => {
  const globals = globalThis as Record<symbol, unknown>;
  const BINDER_KEY = Symbol.for('wcstack.binder');

  afterEach(() => {
    delete globals[BINDER_KEY];
  });

  it('プロトコル名が違うものは採らないこと', () => {
    globals[BINDER_KEY] = { protocol: 'other', version: 1, bind: () => undefined };
    expect(getBinder()).toBeNull();
  });

  it('version が 1 未満のものは採らないこと', () => {
    globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 0, bind: () => undefined };
    expect(getBinder()).toBeNull();
  });

  it('bind を持たないものは採らないこと', () => {
    globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 1 };
    expect(getBinder()).toBeNull();
  });
});

// 起動後の挿入（ナビゲーション）では読み込み順が決着済みなので、load を待たずに
// その場で判定する。`readyState` を差し替えて両方の枝を通す。
describe('警告の判定タイミング', () => {
  const created: Element[] = [];
  let warn: ReturnType<typeof vi.spyOn>;

  const make = (): Element => {
    const host = document.createElement('div');
    host.innerHTML = '<h2 data-wcs="textContent: title"></h2>';
    const element = host.firstElementChild as Element;
    created.push(element);
    return element;
  };

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    _resetUnboundMarkupWarnings(created);
    created.length = 0;
    vi.restoreAllMocks();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('wcstack.binder')];
  });

  it('readyState が complete なら即座に判定すること', () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState');
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    try {
      warnUnboundMarkup(make(), 'here', 'do that');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(Document.prototype, 'readyState', original);
      Reflect.deleteProperty(document, 'readyState');
    }
  });

  it('complete でなければ load を待つこと', () => {
    Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
    try {
      warnUnboundMarkup(make(), 'here', 'do that');
      expect(warn).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('load'));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, 'readyState');
    }
  });
});
