import { describe, it, expect, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { installGlobals, extractStateData, GLOBALS_KEYS } from '../src/render';

describe('GLOBALS_KEYS', () => {
  it('必要なブラウザグローバルが定義されている', () => {
    expect(GLOBALS_KEYS).toContain('document');
    expect(GLOBALS_KEYS).toContain('customElements');
    expect(GLOBALS_KEYS).toContain('HTMLElement');
    expect(GLOBALS_KEYS).toContain('Node');
    expect(GLOBALS_KEYS).toContain('NodeFilter');
    expect(GLOBALS_KEYS).toContain('Element');
    expect(GLOBALS_KEYS).toContain('DocumentFragment');
    expect(GLOBALS_KEYS).toContain('MutationObserver');
  });
});

describe('installGlobals', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('happy-dom の globals を globalThis にセットする', () => {
    const window = new Window();
    restore = installGlobals(window);

    // happy-dom の document がグローバルにセットされている
    expect((globalThis as any).document).toBe(window.document);
    expect((globalThis as any).customElements).toBe((window as any).customElements);
  });

  it('restore で元のグローバルに戻る', () => {
    const originalDocument = (globalThis as any).document;
    const window = new Window();
    restore = installGlobals(window);

    expect((globalThis as any).document).toBe(window.document);

    restore();
    restore = null;

    expect((globalThis as any).document).toBe(originalDocument);
  });

  it('URL.createObjectURL を無効化する', () => {
    const window = new Window();
    restore = installGlobals(window);

    // loadFromInnerScript が base64 フォールバックを使うために無効化
    expect(URL.createObjectURL).toBeUndefined();
  });

  it('restore で URL.createObjectURL が復元される', () => {
    const original = URL.createObjectURL;
    const window = new Window();
    restore = installGlobals(window);

    restore();
    restore = null;

    expect(URL.createObjectURL).toBe(original);
  });
});

describe('extractStateData', () => {
  it('__state からデータプロパティを抽出する', () => {
    const stateEl = {
      __state: {
        count: 42,
        name: 'Alice',
        items: [1, 2, 3],
      },
    };
    expect(extractStateData(stateEl)).toEqual({
      count: 42,
      name: 'Alice',
      items: [1, 2, 3],
    });
  });

  it('$ プレフィックスのプロパティを除外する', () => {
    const stateEl = {
      __state: {
        count: 0,
        $connectedCallback: async () => {},
        $disconnectedCallback: () => {},
      },
    };
    const data = extractStateData(stateEl);
    expect(data).toEqual({ count: 0 });
    expect(data.$connectedCallback).toBeUndefined();
    expect(data.$disconnectedCallback).toBeUndefined();
  });

  it('関数を除外する', () => {
    const stateEl = {
      __state: {
        count: 0,
        increment() { /* noop */ },
        decrement: () => { /* noop */ },
      },
    };
    const data = extractStateData(stateEl);
    expect(data).toEqual({ count: 0 });
    expect(data.increment).toBeUndefined();
    expect(data.decrement).toBeUndefined();
  });

  it('__state が未定義の場合は空オブジェクトを返す', () => {
    expect(extractStateData({})).toEqual({});
    expect(extractStateData({ __state: undefined })).toEqual({});
    expect(extractStateData({ __state: null })).toEqual({});
  });

  it('ネストしたオブジェクトや配列を保持する', () => {
    const stateEl = {
      __state: {
        user: { name: 'Alice', age: 30 },
        tags: ['a', 'b'],
        matrix: [[1, 2], [3, 4]],
      },
    };
    expect(extractStateData(stateEl)).toEqual({
      user: { name: 'Alice', age: 30 },
      tags: ['a', 'b'],
      matrix: [[1, 2], [3, 4]],
    });
  });

  it('boolean, null, 0 を正しく保持する', () => {
    const stateEl = {
      __state: {
        flag: false,
        empty: null,
        zero: 0,
        emptyStr: '',
      },
    };
    expect(extractStateData(stateEl)).toEqual({
      flag: false,
      empty: null,
      zero: 0,
      emptyStr: '',
    });
  });
});
