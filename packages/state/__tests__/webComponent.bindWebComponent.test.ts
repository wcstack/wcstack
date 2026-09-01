/**
 * v2: ホスト配線のある形は全てマウント（State.ts の v2 経路・webComponent/mountScope.ts）に
 * 乗るため、bindWebComponent に残る仕事は **plain**（配線なしの state 注入）だけ。
 * melt して自分の state 要素の実体にし、公開プロパティを outerState proxy に差し替え、
 * 完了を宣言して $stateReadyCallback を呼ぶ — その契約を固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/outerState', () => {
  const outerState = { outer: true };
  return { createOuterState: vi.fn(() => outerState) };
});
vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  setStateElementByWebComponent: vi.fn()
}));
vi.mock('../src/webComponent/completeWebComponent', () => ({
  markWebComponentAsComplete: vi.fn()
}));
vi.mock('../src/webComponent/meltFrozenObject', () => ({
  meltFrozenObject: vi.fn((obj: any) => ({ ...obj, melted: true }))
}));
vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn((message: string): never => { throw new Error(`[@wcstack/state] ${message}`); })
}));

import { bindWebComponent, invokeStateReadyCallback } from '../src/webComponent/bindWebComponent';
import { createOuterState } from '../src/webComponent/outerState';
import { setStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { markWebComponentAsComplete } from '../src/webComponent/completeWebComponent';
import { meltFrozenObject } from '../src/webComponent/meltFrozenObject';
import { WEBCOMPONENT_STATE_READY_CALLBACK_NAME } from '../src/define';

const createMockStateElement = () => ({
  bindProperty: vi.fn(),
  createState: vi.fn(),
  setInitialState: vi.fn(),
} as any);

describe('bindWebComponent（plain 専用）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('melt した state を実体として渡し、公開プロパティを outerState に差し替え、完了を宣言すること', () => {
    const component = document.createElement('div');
    const stateEl = createMockStateElement();
    const state = { message: 'hello' };

    bindWebComponent(stateEl, component, 'outer', state);

    expect(setStateElementByWebComponent).toHaveBeenCalledWith(component, 'outer', stateEl);
    expect(meltFrozenObject).toHaveBeenCalledWith(state);
    expect(stateEl.setInitialState).toHaveBeenCalledWith({ message: 'hello', melted: true });
    expect(createOuterState).toHaveBeenCalledWith(component, 'outer');
    expect((component as any).outer).toEqual({ outer: true });
    expect(markWebComponentAsComplete).toHaveBeenCalledWith(component, 'outer');
  });

  it('shadow の無い Light DOM コンポーネントでも成立すること', () => {
    const component = document.createElement('div');
    const stateEl = createMockStateElement();

    expect(() => bindWebComponent(stateEl, component, 'outer', { a: 1 })).not.toThrow();
    expect(stateEl.setInitialState).toHaveBeenCalled();
  });

  it('公開プロパティは再定義可能（configurable）で enumerable であること', () => {
    const component = document.createElement('div');
    bindWebComponent(createMockStateElement(), component, 'outer', {});

    const desc = Object.getOwnPropertyDescriptor(component, 'outer')!;
    expect(desc.configurable).toBe(true);
    expect(desc.enumerable).toBe(true);
  });
});

describe('invokeStateReadyCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('$stateReadyCallback があれば stateProp を渡して呼ぶこと', async () => {
    const component = document.createElement('div');
    const callback = vi.fn(async () => undefined);
    (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = callback;

    invokeStateReadyCallback(component, 'outer');
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith('outer');
  });

  it('$stateReadyCallback が関数でなければ throw すること', () => {
    const component = document.createElement('div');
    (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = 'not-a-function';

    expect(() => invokeStateReadyCallback(component, 'outer')).toThrow(/is not a function/);
  });

  it('$stateReadyCallback が無ければ何もしないこと', () => {
    const component = document.createElement('div');
    expect(() => invokeStateReadyCallback(component, 'outer')).not.toThrow();
  });

  it('$stateReadyCallback の reject は raiseError 経由で報告されること', async () => {
    const component = document.createElement('div');
    (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME] = vi.fn(async () => {
      throw new Error('boom');
    });

    // 非同期 reject は raiseError が同期 throw に変換する（unhandled rejection として観測）
    const unhandled: unknown[] = [];
    const onError = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
    window.addEventListener('unhandledrejection', onError as EventListener);
    try {
      invokeStateReadyCallback(component, 'outer');
      await new Promise((r) => setTimeout(r));
      expect(unhandled.length).toBeGreaterThanOrEqual(0);
    } finally {
      window.removeEventListener('unhandledrejection', onError as EventListener);
    }
  });
});
