/**
 * devtools/bridge.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の state 側実装。
 *
 * - registry 最小実装: `globalThis.__WCSTACK_DEVTOOLS_HOOK__` を create-if-missing で
 *   確保する（ロード順非依存・先勝ち。devtools 側 client も同一仕様の実装を持つ）。
 * - source: この state モジュールコピーを 1 source として登録する。同一ページに
 *   コピーが複数あれば複数 source になる（正常系、protocol §5）。
 * - sink 切替: listener の有無に応じて registry が `_setSink` を呼び、ここで
 *   updater の drain リスナー登録/解除も連動させる（protocol §4.3）。
 */

import { inSsr } from "../config";
import { getStateElementByName, getLiveStateElements } from "../stateElementByName";
import { registerUpdateBatchListener, unregisterUpdateBatchListener, UpdateBatchListener } from "../updater/updater";
import { raiseError } from "../raiseError";
import { VERSION } from "../version";
import { IStateElement } from "../components/types";
import { devtoolsSink, setDevtoolsSink } from "./sink";
import {
  DEVTOOLS_HOOK_GLOBAL,
  DEVTOOLS_PROTOCOL_VERSION,
  DevtoolsSink,
  IDevtoolsHookRegistry,
  IDevtoolsListener,
  IDevtoolsSource,
  IStateElementSummary,
} from "./types";

/**
 * registry の最小実装（protocol §2）。30 行程度に抑え、振る舞いは
 * 「source/listener の管理と sink の配線」のみ。台帳・整形は devtools 側の責務。
 */
function createMinimalRegistry(): IDevtoolsHookRegistry {
  const sources = new Map<string, IDevtoolsSource>();
  const listeners = new Set<IDevtoolsListener>();
  const applySink = (source: IDevtoolsSource): void => {
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
    register(source: IDevtoolsSource): void {
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
    addListener(listener: IDevtoolsListener): () => void {
      listeners.add(listener);
      // 既登録 source をリプレイ（遅延アタッチの起点、protocol §6）
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

export function getOrCreateHookRegistry(): IDevtoolsHookRegistry {
  const globals = globalThis as unknown as Record<string, unknown>;
  const existing = globals[DEVTOOLS_HOOK_GLOBAL] as IDevtoolsHookRegistry | undefined;
  if (existing !== undefined) {
    if (existing.version !== DEVTOOLS_PROTOCOL_VERSION) {
      // 先勝ち固定。振る舞いは差し替えない（protocol §2）
      console.warn(
        `[wcstack/state] devtools hook registry version mismatch: found ${existing.version}, expected ${DEVTOOLS_PROTOCOL_VERSION}. Keeping the existing registry (first-wins).`
      );
    }
    return existing;
  }
  const registry = createMinimalRegistry();
  globals[DEVTOOLS_HOOK_GLOBAL] = registry;
  return registry;
}

/**
 * drain 終了バッチの転送リスナー。sink 接続中のみ updater に登録される。
 */
const onUpdateBatch: UpdateBatchListener = (batch) => {
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:update-batch", addresses: batch });
  }
};

/**
 * registry からの sink 差し替え。updater の drain リスナー登録/解除を連動させる。
 * detach 時に登録が残らないこと（protocol §7-2）。
 */
function setSink(sink: DevtoolsSink | null): void {
  const wasActive = devtoolsSink !== null;
  setDevtoolsSink(sink);
  const isActive = sink !== null;
  if (isActive && !wasActive) {
    registerUpdateBatchListener(onUpdateBatch);
  } else if (!isActive && wasActive) {
    unregisterUpdateBatchListener(onUpdateBatch);
  }
}

function createStateElementSummary(element: IStateElement): IStateElementSummary {
  return {
    name: element.name,
    rootNode: element.rootNode,
    element,
    paths: {
      list: element.listPaths,
      element: element.elementPaths,
      getter: element.getterPaths,
      setter: element.setterPaths,
    },
    commandTokenNames: element.commandTokenNames,
    eventTokenNames: element.eventTokenNames,
    staticDependency: element.staticDependency,
    dynamicDependency: element.dynamicDependency,
  };
}

function requireStateElement(name: string, rootNode: Node): IStateElement {
  return getStateElementByName(rootNode, name) ??
    raiseError(`devtools: state element not found: name="${name}"`);
}

function createSourceId(): string {
  // getUUID() はモジュールローカル連番のため、state コピーが複数ある
  // ページで source id が衝突する。ランダム採番で回避する。
  return "state:" + Math.random().toString(36).slice(2, 10);
}

let registeredSource: IDevtoolsSource | null = null;

/**
 * この state ランタイムを 1 source として registry に登録する。
 * bootstrapState() から呼ばれる。冪等・SSR では何もしない（protocol 原則 6）。
 */
export function registerDevtoolsSource(): void {
  if (inSsr()) {
    return;
  }
  if (registeredSource !== null) {
    return;
  }
  const source: IDevtoolsSource = {
    id: createSourceId(),
    kind: "state",
    packageVersion: VERSION,
    getStateElements(): IStateElementSummary[] {
      const summaries: IStateElementSummary[] = [];
      for (const element of getLiveStateElements()) {
        summaries.push(createStateElementSummary(element));
      }
      return summaries;
    },
    read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown {
      const element = requireStateElement(name, rootNode);
      let result: unknown;
      element.createState("readonly", (state) => {
        result = (state as unknown as Record<string, (p: string, i: number[]) => unknown>)["$resolve"](path, indexes ?? []);
      });
      return result;
    },
    write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void {
      const element = requireStateElement(name, rootNode);
      element.createState("writable", (state) => {
        if (indexes !== undefined && indexes.length > 0) {
          // Note: $resolve は value===undefined を「取得」と解釈するため、
          // ワイルドカードパスへの undefined 書き込みは非サポート
          // （spread undefined 規範と同じ側に倒す）
          (state as unknown as Record<string, (p: string, i: number[], v: unknown) => void>)["$resolve"](path, indexes, value);
        } else {
          (state as unknown as Record<string, unknown>)[path] = value;
        }
      });
    },
    _setSink: setSink,
  };
  registeredSource = source;
  getOrCreateHookRegistry().register(source);
}

/**
 * テスト専用: sink を解除し source 登録状態をリセットする。
 * グローバル registry 自体の掃除（delete globalThis[DEVTOOLS_HOOK_GLOBAL]）は
 * テスト側の責務。アプリケーションからの利用は想定しない。
 */
export function __resetDevtoolsBridgeForTest(): void {
  setSink(null);
  registeredSource = null;
}

/** テスト専用: 現在登録済みの source を返す */
export function __getRegisteredSourceForTest(): IDevtoolsSource | null {
  return registeredSource;
}
