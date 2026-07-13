/**
 * protocol/registry.ts
 *
 * registry 最小実装の devtools 側コピー（protocol §2）。
 * ロード順非依存にするため、ランタイム側（@wcstack/state の bridge）と
 * devtools 側の両方が同一仕様の最小実装を持ち、先にロードされた方が
 * globalThis に置く（先勝ち・振る舞い差し替えなし）。
 */

import {
  DEVTOOLS_HOOK_GLOBAL,
  DEVTOOLS_PROTOCOL_VERSION,
  IDevtoolsHookRegistryLike,
  IDevtoolsListenerLike,
  IDevtoolsSourceLike,
} from "./types";

function createMinimalRegistry(): IDevtoolsHookRegistryLike {
  const sources = new Map<string, IDevtoolsSourceLike>();
  const listeners = new Set<IDevtoolsListenerLike>();
  const applySink = (source: IDevtoolsSourceLike): void => {
    if (listeners.size === 0) {
      source._setSink(null);
      return;
    }
    const sourceId = source.id;
    source._setSink((event) => {
      for (const listener of listeners) {
        listener.onEvent?.(sourceId, event);
      }
    });
  };
  return {
    version: DEVTOOLS_PROTOCOL_VERSION,
    sources,
    register(source: IDevtoolsSourceLike): void {
      if (sources.has(source.id)) {
        return;
      }
      sources.set(source.id, source);
      applySink(source);
      for (const listener of listeners) {
        listener.onSourceRegistered?.(source);
      }
    },
    unregister(sourceId: string): void {
      const source = sources.get(sourceId);
      if (source === undefined) {
        return;
      }
      source._setSink(null);
      sources.delete(sourceId);
      for (const listener of listeners) {
        listener.onSourceUnregistered?.(sourceId);
      }
    },
    addListener(listener: IDevtoolsListenerLike): () => void {
      listeners.add(listener);
      for (const source of sources.values()) {
        applySink(source);
        listener.onSourceRegistered?.(source);
      }
      return () => {
        if (!listeners.delete(listener)) {
          return;
        }
        for (const source of sources.values()) {
          applySink(source);
        }
      };
    },
  };
}

export function getOrCreateHookRegistry(): IDevtoolsHookRegistryLike {
  const globals = globalThis as unknown as Record<string, unknown>;
  const existing = globals[DEVTOOLS_HOOK_GLOBAL] as IDevtoolsHookRegistryLike | undefined;
  if (existing !== undefined) {
    if (existing.version !== DEVTOOLS_PROTOCOL_VERSION) {
      // 先勝ち固定。振る舞いは差し替えない（protocol §2）
      console.warn(
        `[wcstack/devtools] hook registry version mismatch: found ${existing.version}, expected ${DEVTOOLS_PROTOCOL_VERSION}. Keeping the existing registry (first-wins).`
      );
    }
    return existing;
  }
  const registry = createMinimalRegistry();
  globals[DEVTOOLS_HOOK_GLOBAL] = registry;
  return registry;
}
