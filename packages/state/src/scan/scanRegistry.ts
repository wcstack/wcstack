/**
 * scan/scanRegistry.ts
 *
 * `$scan` の registry（docs/state-scan-design.md §2）。
 *
 * `$watch` の registry とは別台帳にする。watch の registry はパスにつき entry 1 個
 * （`Map<string, IWatchEntry>`）なので、同じパスを `$watch` と `$scan` が並んで
 * 見る形・同じ `from` を 2 つの scan が畳む形を載せられない。
 *
 * 寿命は `$watch` と揃える: `_state` 再セットで作り直し、切断では消さない
 * （発火対象から外れるのは watch runtime の active 集合側）。
 */

import type { IStateElement } from "../components/types";
import type { IScanEntry, IScanRegistry } from "./types";

const registryByStateElement: WeakMap<IStateElement, IScanRegistry> = new WeakMap();

/**
 * drain 側の粗いゲート: `from` か `resetOn` を持つ registry の数。
 *
 * 0 のあいだ watch runtime は scan の収集ループに入らない ＝ `$watch` だけを使う
 * アプリの drain に、バッチのアドレスごとの registry 引きを載せない。
 * clear を経ずに GC された stateElement のぶんは減らない（ゲートが開いたままになるだけで、
 * 正しさには影響しない）。
 */
let drainRegistryCount = 0;

/**
 * enqueue 側のゲート: `resetOn` を持つ `on` scan がある registry の数（scan/eventReset.ts）。
 * 0 のあいだ updater の enqueue は整数比較 1 回で抜ける。数え方の注意は drainRegistryCount と同じ。
 */
let eventResetRegistryCount = 0;

function hasDrainWork(registry: IScanRegistry): boolean {
  return registry.byFromPath.size > 0 || registry.byResetPath.size > 0;
}

function hasEventResetWork(registry: IScanRegistry): boolean {
  return registry.eventResetByPath.size > 0;
}

function pushEntry(map: Map<string, IScanEntry[]>, key: string, entry: IScanEntry): void {
  const list = map.get(key);
  if (typeof list === "undefined") {
    map.set(key, [entry]);
  } else {
    list.push(entry);
  }
}

/** registry を置換登録する（`_state` セッターから）。 */
export function setScanRegistry(stateElement: IStateElement, entries: readonly IScanEntry[]): IScanRegistry {
  clearScanRegistry(stateElement);
  const byFromPath = new Map<string, IScanEntry[]>();
  const byResetPath = new Map<string, IScanEntry[]>();
  const eventResetByPath = new Map<string, IScanEntry[]>();
  for (const entry of entries) {
    if (entry.source.kind === "path") {
      pushEntry(byFromPath, entry.source.path, entry);
    }
    for (const path of entry.resetOn) {
      pushEntry(byResetPath, path, entry);
      if (entry.source.kind === "event") {
        pushEntry(eventResetByPath, path, entry);
      }
    }
  }
  const registry: IScanRegistry = { entries: new Set(entries), byFromPath, byResetPath, eventResetByPath };
  registryByStateElement.set(stateElement, registry);
  if (hasDrainWork(registry)) {
    drainRegistryCount++;
  }
  if (hasEventResetWork(registry)) {
    eventResetRegistryCount++;
  }
  return registry;
}

export function getScanRegistry(stateElement: IStateElement): IScanRegistry | undefined {
  return registryByStateElement.get(stateElement);
}

/** registry を削除する（`_state` 再セットで作り直す前）。 */
export function clearScanRegistry(stateElement: IStateElement): void {
  const registry = registryByStateElement.get(stateElement);
  if (typeof registry === "undefined") {
    return;
  }
  if (hasDrainWork(registry)) {
    drainRegistryCount--;
  }
  if (hasEventResetWork(registry)) {
    eventResetRegistryCount--;
  }
  registryByStateElement.delete(stateElement);
}

/**
 * drain で発火すべき scan（`from` か `resetOn`）を持つか。
 * `startWatch` が発火対象集合へ載せる判定に使う（`on` だけの scan は drain を要らない）。
 */
export function hasScanDrainWork(stateElement: IStateElement): boolean {
  const registry = registryByStateElement.get(stateElement);
  return typeof registry !== "undefined" && hasDrainWork(registry);
}

export function getScanDrainRegistryCount(): number {
  return drainRegistryCount;
}

export function getScanEventResetRegistryCount(): number {
  return eventResetRegistryCount;
}

export const __private__ = {
  registryByStateElement,
};
