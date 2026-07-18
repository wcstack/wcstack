import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDevtoolsSink, devtoolsSink } from '../src/devtools/sink';
import { DevtoolsEvent } from '../src/devtools/types';
import { setStateElementByName, getLiveStateElements } from '../src/stateElementByName';
import {
  addBindingByAbsoluteStateAddress,
  removeBindingByAbsoluteStateAddress,
  clearBindingSetByAbsoluteStateAddress,
  peekBindingsByAbsoluteStateAddress,
} from '../src/binding/getBindingSetByAbsoluteStateAddress';
import { CommandToken } from '../src/command/CommandToken';
import { EventToken } from '../src/event/EventToken';
import { getOrCreateCommandToken } from '../src/command/commandTokenRegistry';
import { getOrCreateEventToken } from '../src/event/eventTokenRegistry';
import { setByAddress } from '../src/proxy/methods/setByAddress';
import { setConfig } from '../src/config';
import { createStateAddress } from '../src/address/StateAddress';
import { getPathInfo } from '../src/address/PathInfo';

function createMockStateElement(name: string): any {
  return {
    name,
    rootNode: document.createElement('div'),
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    staticDependency: new Map<string, string[]>(),
    dynamicDependency: new Map<string, string[]>(),
    bindableEventMap: {},
  };
}

describe('devtools 計装点', () => {
  const events: DevtoolsEvent[] = [];

  beforeEach(() => {
    events.length = 0;
    setDevtoolsSink((event) => events.push(event));
  });

  afterEach(() => {
    setDevtoolsSink(null);
  });

  describe('sink', () => {
    it('setDevtoolsSinkでlive bindingが切り替わること', () => {
      expect(devtoolsSink).not.toBeNull();
      setDevtoolsSink(null);
      expect(devtoolsSink).toBeNull();
    });
  });

  describe('state要素の登録簿（protocol §4.1）', () => {
    it('登録・解除がliveStateElementsとイベントに反映されること', () => {
      const element = createMockStateElement('instr-a');
      const rootNode = element.rootNode;

      setStateElementByName(rootNode, 'instr-a', element);
      expect(getLiveStateElements().has(element)).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:element-registered', name: 'instr-a', element })
      );

      setStateElementByName(rootNode, 'instr-a', null);
      expect(getLiveStateElements().has(element)).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:element-unregistered', name: 'instr-a', element })
      );
    });

    it('sink未接続では登録簿だけ更新されイベントは出ないこと', () => {
      setDevtoolsSink(null);
      const element = createMockStateElement('instr-b');
      setStateElementByName(element.rootNode, 'instr-b', element);
      expect(getLiveStateElements().has(element)).toBe(true);
      setStateElementByName(element.rootNode, 'instr-b', null);
      expect(getLiveStateElements().has(element)).toBe(false);
      expect(events.length).toBe(0);
    });

    it('未登録名の解除ではイベントを出さないこと', () => {
      const element = createMockStateElement('instr-c');
      const rootNode = element.rootNode;
      setStateElementByName(rootNode, 'instr-c', element);
      events.length = 0;
      // 同一rootNodeの別名を解除 → removed undefined の分岐
      setStateElementByName(rootNode, 'no-such-name', null);
      expect(events.length).toBe(0);
      setStateElementByName(rootNode, 'instr-c', null);
    });
  });

  describe('binding台帳（protocol §4.4）', () => {
    it('add/remove/clearがイベントを発すること', () => {
      const absAddress: any = { __tag: 'abs-address' };
      const binding: any = { __tag: 'binding' };

      addBindingByAbsoluteStateAddress(absAddress, binding);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:binding-added', absoluteAddress: absAddress, binding })
      );
      expect(peekBindingsByAbsoluteStateAddress(absAddress)).toBe(binding);

      removeBindingByAbsoluteStateAddress(absAddress, binding);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:binding-removed', absoluteAddress: absAddress, binding })
      );

      clearBindingSetByAbsoluteStateAddress(absAddress);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:binding-cleared', absoluteAddress: absAddress })
      );
    });

    it('未登録アドレスのremoveはイベントを出さないこと', () => {
      events.length = 0;
      removeBindingByAbsoluteStateAddress({ __tag: 'unknown' } as any, { __tag: 'b' } as any);
      expect(events.length).toBe(0);
    });

    it('sink未接続ではイベントなしで台帳のみ更新されること', () => {
      setDevtoolsSink(null);
      const absAddress: any = { __tag: 'abs-silent' };
      const binding: any = { __tag: 'binding-silent' };
      addBindingByAbsoluteStateAddress(absAddress, binding);
      expect(peekBindingsByAbsoluteStateAddress(absAddress)).toBe(binding);
      removeBindingByAbsoluteStateAddress(absAddress, binding);
      clearBindingSetByAbsoluteStateAddress(absAddress);
      expect(events.length).toBe(0);
    });
  });

  describe('token emit（protocol §4.5）', () => {
    it('CommandToken.emitがkind=commandのイベントを発し、結果はTokenと同一なこと', () => {
      const token = new CommandToken('play', 'media');
      const fn = vi.fn().mockReturnValue('ok');
      token.subscribe(fn);
      const results = token.emit('a', 1);
      expect(results).toEqual(['ok']);
      expect(fn).toHaveBeenCalledWith('a', 1);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'state:token-emit',
          kind: 'command',
          stateName: 'media',
          tokenName: 'play',
          args: ['a', 1],
          subscriberCount: 1,
        })
      );
    });

    it('subscriber 0の空撃ちもsubscriberCount=0で流れること', () => {
      const token = new CommandToken('orphan');
      token.emit();
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:token-emit', kind: 'command', stateName: null, subscriberCount: 0 })
      );
    });

    it('EventToken.emitがkind=eventのイベントを発すること', () => {
      const token = new EventToken('changed', 'form');
      token.emit({ value: 1 });
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'state:token-emit', kind: 'event', stateName: 'form', tokenName: 'changed' })
      );
    });

    it('registryがstateElement.nameをownerとして渡すこと', () => {
      const stateElement = createMockStateElement('owner-state');
      getOrCreateCommandToken(stateElement, 'cmd').emit();
      getOrCreateEventToken(stateElement, 'evt').emit();
      expect(events).toContainEqual(
        expect.objectContaining({ kind: 'command', tokenName: 'cmd', stateName: 'owner-state' })
      );
      expect(events).toContainEqual(
        expect.objectContaining({ kind: 'event', tokenName: 'evt', stateName: 'owner-state' })
      );
    });

    it('sink未接続ではemitは素通りすること', () => {
      setDevtoolsSink(null);
      const token = new CommandToken('silent');
      const fn = vi.fn();
      token.subscribe(fn);
      token.emit(1);
      expect(fn).toHaveBeenCalledWith(1);
      expect(events.length).toBe(0);
    });
  });

  describe('setByAddress write イベント（protocol §4.2）', () => {
    function createHandler(stateElement: any) {
      return {
        stateElement,
        stateName: stateElement.name,
        pushAddress: vi.fn(),
        popAddress: vi.fn(),
      };
    }

    afterEach(() => {
      setConfig({ sameValueGuard: true });
    });

    it('guard OFF時はhasOldValue=falseでwriteイベントが出ること', () => {
      setConfig({ sameValueGuard: false });
      const target = { count: 1 };
      const address = createStateAddress(getPathInfo('count'), null);
      const stateElement = createMockStateElement('w1');
      setByAddress(target, address, 5, target, createHandler(stateElement) as any);

      const write = events.find((e) => e.type === 'state:write') as any;
      expect(write).toBeDefined();
      expect(write.value).toBe(5);
      expect(write.hasOldValue).toBe(false);
      expect(write.oldValue).toBeUndefined();
      expect(write.absoluteAddress.absolutePathInfo.pathInfo.path).toBe('count');
      expect(target.count).toBe(5);
    });

    it('guard ON + primitiveではoldValueが載ること', () => {
      setConfig({ sameValueGuard: true });
      const target = { count: 1 };
      const address = createStateAddress(getPathInfo('count'), null);
      const stateElement = createMockStateElement('w2');
      setByAddress(target, address, 5, target, createHandler(stateElement) as any);

      const write = events.find((e) => e.type === 'state:write') as any;
      expect(write.hasOldValue).toBe(true);
      expect(write.oldValue).toBe(1);
      expect(write.value).toBe(5);
    });

    it('guardで弾かれた同値setはイベントを出さないこと', () => {
      setConfig({ sameValueGuard: true });
      const target = { count: 5 };
      const address = createStateAddress(getPathInfo('count'), null);
      const stateElement = createMockStateElement('w3');
      const result = setByAddress(target, address, 5, target, createHandler(stateElement) as any);
      expect(result).toBe(true);
      expect(events.find((e) => e.type === 'state:write')).toBeUndefined();
    });

    it('sink未接続では書き込みのみ行われイベントは出ないこと', () => {
      setDevtoolsSink(null);
      setConfig({ sameValueGuard: false });
      const target = { count: 1 };
      const address = createStateAddress(getPathInfo('count'), null);
      const stateElement = createMockStateElement('w4');
      setByAddress(target, address, 7, target, createHandler(stateElement) as any);
      expect(target.count).toBe(7);
      expect(events.length).toBe(0);
    });
  });
});
