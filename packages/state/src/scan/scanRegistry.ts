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
 * drain 側の粗いゲート: 発火対象（watch runtime の active 集合）に居て、`from` か `resetOn` を持つ state。
 *
 * 空のあいだ watch runtime は scan の収集ループに入らない ＝ `$scan` を使っていない画面の drain に、
 * バッチのアドレスごとの registry 引きを載せない。registry の有無ではなく active 集合への出入り
 * （watch/watchRegistry.ts の addActiveWatchStateElement / deactivateWatch / clearWatchRegistry）で
 * 数えるので、`$scan` を持つ state を DOM から外せば（SPA のページ差し替え）ゲートは閉じ、
 * 再接続（startWatch）で開き直す。strong Set でも、切断と再セットで必ず外れるので GC を妨げない
 * （active 集合と同じ不変条件）。
 */
const drainActive = new Set<IStateElement>();

/**
 * enqueue 側のゲート: 発火対象に居て、`resetOn` を持つ `on` scan がある state（scan/eventReset.ts）。
 * 空のあいだ updater の enqueue は整数比較 1 回で抜ける。数え方は drainActive と同じ。
 */
const eventResetActive = new Set<IStateElement>();

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
  return registry;
}

export function getScanRegistry(stateElement: IStateElement): IScanRegistry | undefined {
  return registryByStateElement.get(stateElement);
}

/**
 * registry を削除する（`_state` 再セットで作り直す前）。ゲートからも外す — 同じ再セットの
 * startWatch が新しい registry で数え直す（`_state` セッターは registry を作った後に
 * clearWatchRegistry → startWatch を通る）。
 */
export function clearScanRegistry(stateElement: IStateElement): void {
  deactivateScanGates(stateElement);
  registryByStateElement.delete(stateElement);
}

/** 発火対象に載った（watch/watchRegistry.ts の addActiveWatchStateElement 専用）。冪等。 */
export function activateScanGates(stateElement: IStateElement): void {
  const registry = registryByStateElement.get(stateElement);
  if (typeof registry === "undefined") {
    return;
  }
  if (hasDrainWork(registry)) {
    drainActive.add(stateElement);
  }
  if (hasEventResetWork(registry)) {
    eventResetActive.add(stateElement);
  }
}

/** 発火対象から外れた（切断・再セット）。 */
export function deactivateScanGates(stateElement: IStateElement): void {
  drainActive.delete(stateElement);
  eventResetActive.delete(stateElement);
}

/**
 * drain で発火すべき scan（`from` か `resetOn`）を持つか。
 * `startWatch` が発火対象集合へ載せる判定に使う（`on` だけの scan は drain を要らない）。
 */
export function hasScanDrainWork(stateElement: IStateElement): boolean {
  const registry = registryByStateElement.get(stateElement);
  return typeof registry !== "undefined" && hasDrainWork(registry);
}

/** 発火対象に居て、`resetOn` を持つ `on` scan がある state か（enqueue の保留判定）。 */
export function hasActiveScanEventReset(stateElement: IStateElement): boolean {
  return eventResetActive.has(stateElement);
}

export function getScanDrainGateCount(): number {
  return drainActive.size;
}

export function getScanEventResetGateCount(): number {
  return eventResetActive.size;
}
