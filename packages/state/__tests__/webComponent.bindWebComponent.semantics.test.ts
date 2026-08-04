/**
 * bindWebComponent の「意味論」の回帰テスト。
 *
 * webComponent.bindWebComponent.test.ts は outerState / plainOuterState / innerState /
 * MappingRule を全てモックするため、「どちらの分岐に入ったか」は検証できても
 * 「component[stateProp] を read / write したら何が起きるか」は 1 度も通っていない。
 * docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.2 / §6 の
 * 指摘どおり、分岐条件のバグはこの穴に落ちていた。ここでは実モジュールを使って
 * read / write の観測可能な結果そのものを固定する。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bindWebComponent } from '../src/webComponent/bindWebComponent';
import { config } from '../src/config';
import { IStateElement } from '../src/components/types';

interface IProbeStateElement extends IStateElement {
  readonly posted: string[];
  readonly initialState: Record<string, any> | null;
}

function createProbeStateElement(store: Record<string, any>): IProbeStateElement {
  const posted: string[] = [];
  let initialState: Record<string, any> | null = null;
  return {
    name: 'default',
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    boundComponentStateProp: 'state',
    get posted() { return posted; },
    get initialState() { return initialState; },
    setInitialState(value: Record<string, any>) { initialState = value; },
    createState(_mutability: string, callback: (state: any) => void) {
      callback(new Proxy(store, {
        get(target, prop: string) {
          if (prop === '$postUpdate') return (path: string) => { posted.push(path); };
          return Reflect.get(target, prop);
        },
      }));
    },
  } as unknown as IProbeStateElement;
}

describe('bindWebComponent の read/write 意味論', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('data-wcs 属性が無ければ read/write が inner state へ素通しすること', () => {
    const component = document.createElement('x-semantics-plain');
    (component as any).state = { msg: 'hello' };
    document.body.appendChild(component);
    const store: Record<string, any> = { msg: 'hello' };

    bindWebComponent(createProbeStateElement(store), component, 'state', (component as any).state);

    expect((component as any).state.msg).toBe('hello');
    (component as any).state.msg = 'written';
    expect((component as any).state.msg).toBe('written');
    expect(store.msg).toBe('written');
  });

  it('data-wcs はあっても <stateProp>.* バインドが無ければ read/write が素通しすること', () => {
    // 修正前はここが mapped 分岐に落ち、read が常に undefined・write が完全な no-op だった。
    const component = document.createElement('x-semantics-unrelated');
    component.setAttribute(config.bindAttributeName, 'class.on: flag');
    (component as any).state = { msg: 'hello' };
    document.body.appendChild(component);
    const store: Record<string, any> = { msg: 'hello' };
    const stateEl = createProbeStateElement(store);

    bindWebComponent(stateEl, component, 'state', (component as any).state);

    expect((component as any).state.msg).toBe('hello');
    (component as any).state.msg = 'written';
    expect((component as any).state.msg).toBe('written');
    expect(store.msg).toBe('written');
    // 通知だけ飛ばす mapped 意味論には落ちていない
    expect(stateEl.posted).toEqual([]);
  });

  it('plain 分岐では melt 済みの生 state が setInitialState に渡ること', () => {
    const component = document.createElement('x-semantics-frozen');
    (component as any).state = Object.freeze({ msg: 'hello' });
    document.body.appendChild(component);
    const stateEl = createProbeStateElement({ msg: 'hello' });

    bindWebComponent(stateEl, component, 'state', (component as any).state);

    expect(stateEl.initialState).toEqual({ msg: 'hello' });
    expect(Object.isFrozen(stateEl.initialState)).toBe(false);
  });
});
