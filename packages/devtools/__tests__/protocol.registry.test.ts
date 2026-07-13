import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrCreateHookRegistry } from '../src/protocol/registry';
import { DEVTOOLS_HOOK_GLOBAL, DEVTOOLS_PROTOCOL_VERSION, IDevtoolsSourceLike } from '../src/protocol/types';

function cleanupGlobal(): void {
  delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
}

export function createFakeSource(id: string): IDevtoolsSourceLike & { sink: ((e: never) => void) | null } {
  const source = {
    id,
    kind: 'state',
    packageVersion: '0.0.0',
    sink: null as ((e: never) => void) | null,
    getStateElements: vi.fn(() => []),
    keys: vi.fn(() => []),
    read: vi.fn(),
    write: vi.fn(),
    _setSink(sink: ((e: never) => void) | null) {
      source.sink = sink;
    },
  };
  return source;
}

describe('protocol/registry', () => {
  beforeEach(cleanupGlobal);
  afterEach(cleanupGlobal);

  it('グローバルに生成し、2回目は同一インスタンスを返すこと', () => {
    const registry = getOrCreateHookRegistry();
    expect(registry.version).toBe(DEVTOOLS_PROTOCOL_VERSION);
    expect(getOrCreateHookRegistry()).toBe(registry);
  });

  it('版不一致の既存registryは警告の上で先勝ちすること', () => {
    const foreign = { version: 999 } as never;
    (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL] = foreign;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getOrCreateHookRegistry()).toBe(foreign);
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('listener追加で既存sourceのリプレイとsink接続が行われること', () => {
    const registry = getOrCreateHookRegistry();
    const source = createFakeSource('state:a');
    registry.register(source);
    expect(source.sink).toBeNull();

    const onSourceRegistered = vi.fn();
    const onEvent = vi.fn();
    const remove = registry.addListener({ onSourceRegistered, onEvent });
    expect(onSourceRegistered).toHaveBeenCalledWith(source);
    expect(source.sink).not.toBeNull();

    source.sink!({ type: 'x' } as never);
    expect(onEvent).toHaveBeenCalledWith('state:a', { type: 'x' });

    remove();
    expect(source.sink).toBeNull();
    // 二重解除は安全
    expect(() => remove()).not.toThrow();
  });

  it('listenerが先に居る場合もregister時に通知とsink接続が行われること', () => {
    const registry = getOrCreateHookRegistry();
    const onSourceRegistered = vi.fn();
    registry.addListener({ onSourceRegistered });
    const source = createFakeSource('state:b');
    registry.register(source);
    expect(onSourceRegistered).toHaveBeenCalledWith(source);
    expect(source.sink).not.toBeNull();
    // 同一idの二重registerは無視
    registry.register(source);
    expect(registry.sources.size).toBe(1);
  });

  it('unregisterでsink切断とonSourceUnregistered通知が行われること', () => {
    const registry = getOrCreateHookRegistry();
    const onSourceUnregistered = vi.fn();
    registry.addListener({ onSourceUnregistered });
    const source = createFakeSource('state:c');
    registry.register(source);
    registry.unregister('state:c');
    expect(source.sink).toBeNull();
    expect(onSourceUnregistered).toHaveBeenCalledWith('state:c');
    expect(registry.sources.size).toBe(0);
    expect(() => registry.unregister('state:unknown')).not.toThrow();
  });
});
