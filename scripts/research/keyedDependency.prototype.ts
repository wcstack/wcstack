/**
 * keyedDependency.ts — next-major prototype (sandbox build only, not shipped). Round 3.
 *
 * Keyed subscriptions behind `$eq(path, key)`, `$eqPath(path, keyPath)` and
 * `$eqIndex(path, level)`: a getter that only needs to know whether `path` currently equals
 * a key subscribes under that key instead of under the path pattern. A write to `path` then
 * notifies only the rows subscribed under the old and the new value, instead of expanding
 * the pattern edge to every row (docs/state-next-major-tech-survey.md T3 mechanism K, D7).
 *
 * Round 3 additions:
 * - the subscription of a row is dropped when the list diff retires the row's list index
 *   (`dropKeyedSubscriptionsByListIndex`, called from list/createListDiff.ts), instead of
 *   being skipped lazily at notification time;
 * - `$eqIndex` subscribes under the row's index and is re-keyed on the diff side when the
 *   index changes (`rekeyIndexSubscriptions`, called from syncListIndexes): a moved row is
 *   enqueued only when the last written value of `path` equals its old or its new index, so
 *   a removal touches at most two rows instead of re-evaluating every moved row.
 *
 * Known prototype limits: Map keys compare with SameValueZero, not Object.is.
 */
import { IAbsoluteStateAddress } from "../address/types";
import { dirtyCacheEntryByAbsoluteStateAddress } from "../cache/cacheEntryByAbsoluteStateAddress";
import { IStateElement } from "../components/types";
import { IListIndex } from "../list/types";
import { getUpdater } from "../updater/updater";

type KeyMap = Map<unknown, Set<IAbsoluteStateAddress>>;
interface IElementLedger {
  readonly byPath: Map<string, KeyMap>;
  /** last value seen for `path` (at registration or at a write); the diff-side re-key reads it */
  readonly lastValue: Map<string, unknown>;
}
interface IEntry {
  readonly stateElement: IStateElement;
  readonly path: string;
  readonly absAddress: IAbsoluteStateAddress;
}
const ledgerByElement = new WeakMap<IStateElement, IElementLedger>();
// Reverse index so that a re-evaluated getter moves its subscription to its new key.
const keyByPathByAddress = new WeakMap<IAbsoluteStateAddress, Map<string, unknown>>();
// Every subscription that hangs on a list index, for the retire hook.
const entriesByListIndex = new WeakMap<IListIndex, IEntry[]>();
// Index-keyed subscriptions (`$eqIndex`) by the list index whose `.index` is their key.
const indexKeyedByListIndex = new WeakMap<IListIndex, IEntry[]>();
let anyRegistered = false;
const EMPTY: IAbsoluteStateAddress[] = [];

function ledgerOf(stateElement: IStateElement): IElementLedger {
  let ledger = ledgerByElement.get(stateElement);
  if (typeof ledger === "undefined") {
    ledgerByElement.set(stateElement, ledger = { byPath: new Map(), lastValue: new Map() });
  }
  return ledger;
}

function keyMapOf(ledger: IElementLedger, path: string): KeyMap {
  let keyMap = ledger.byPath.get(path);
  if (typeof keyMap === "undefined") {
    ledger.byPath.set(path, keyMap = new Map());
  }
  return keyMap;
}

function subscribe(ledger: IElementLedger, path: string, key: unknown, absAddress: IAbsoluteStateAddress): boolean {
  const keyMap = keyMapOf(ledger, path);
  let previous = keyByPathByAddress.get(absAddress);
  if (typeof previous === "undefined") {
    keyByPathByAddress.set(absAddress, previous = new Map());
  }
  let isNew = true;
  if (previous.has(path)) {
    const oldKey = previous.get(path);
    if (Object.is(oldKey, key)) {
      return false;
    }
    keyMap.get(oldKey)?.delete(absAddress);
    isNew = false;
  }
  previous.set(path, key);
  let set = keyMap.get(key);
  if (typeof set === "undefined") {
    keyMap.set(key, set = new Set());
  }
  set.add(absAddress);
  return isNew;
}

function trackByListIndex(map: WeakMap<IListIndex, IEntry[]>, listIndex: IListIndex, entry: IEntry): void {
  let entries = map.get(listIndex);
  if (typeof entries === "undefined") {
    map.set(listIndex, entries = []);
  }
  for (const e of entries) {
    if (e.absAddress === entry.absAddress && e.path === entry.path) return;
  }
  entries.push(entry);
}

/** `$eq` / `$eqPath`: subscribe the evaluating row under `key`; `current` is the value of `path` read now. */
export function registerKeyedDependency(
  stateElement: IStateElement,
  path: string,
  key: unknown,
  absAddress: IAbsoluteStateAddress,
  current: unknown,
): void {
  anyRegistered = true;
  const ledger = ledgerOf(stateElement);
  ledger.lastValue.set(path, current);
  const isNew = subscribe(ledger, path, key, absAddress);
  if (isNew && absAddress.listIndex !== null) {
    trackByListIndex(entriesByListIndex, absAddress.listIndex, { stateElement, path, absAddress });
  }
}

/** `$eqIndex`: subscribe under the index of `levelListIndex`; re-keyed by the diff when the index changes. */
export function registerIndexKeyedDependency(
  stateElement: IStateElement,
  path: string,
  levelListIndex: IListIndex,
  absAddress: IAbsoluteStateAddress,
  current: unknown,
): void {
  anyRegistered = true;
  const ledger = ledgerOf(stateElement);
  ledger.lastValue.set(path, current);
  const isNew = subscribe(ledger, path, levelListIndex.index, absAddress);
  if (isNew) {
    const entry = { stateElement, path, absAddress };
    if (absAddress.listIndex !== null) trackByListIndex(entriesByListIndex, absAddress.listIndex, entry);
    trackByListIndex(indexKeyedByListIndex, levelListIndex, entry);
  }
}

export function hasKeyedDependents(stateElement: IStateElement, path: string): boolean {
  return ledgerByElement.get(stateElement)?.byPath.has(path) === true;
}

function collect(set: Set<IAbsoluteStateAddress> | undefined, out: IAbsoluteStateAddress[]): void {
  if (typeof set === "undefined") return;
  for (const address of set) out.push(address);
}

/** Row addresses subscribed under the old key (when known) and the new key of `path`; records the new value. */
export function keyedDependents(
  stateElement: IStateElement,
  path: string,
  hasOldKey: boolean,
  oldKey: unknown,
  newKey: unknown,
): IAbsoluteStateAddress[] {
  const ledger = ledgerByElement.get(stateElement);
  const keyMap = ledger?.byPath.get(path);
  if (typeof ledger === "undefined" || typeof keyMap === "undefined") {
    return EMPTY;
  }
  ledger.lastValue.set(path, newKey);
  const out: IAbsoluteStateAddress[] = [];
  if (hasOldKey) {
    collect(keyMap.get(oldKey), out);
  }
  if (!hasOldKey || !Object.is(oldKey, newKey)) {
    collect(keyMap.get(newKey), out);
  }
  return out;
}

/** The diff retired `listIndex`: forget every subscription hanging on it (a revived row re-subscribes when evaluated). */
export function dropKeyedSubscriptionsByListIndex(listIndex: IListIndex): void {
  if (!anyRegistered) return;
  const entries = entriesByListIndex.get(listIndex);
  if (typeof entries === "undefined") return;
  entriesByListIndex.delete(listIndex);
  indexKeyedByListIndex.delete(listIndex);
  for (const { stateElement, absAddress } of entries) {
    const keys = keyByPathByAddress.get(absAddress);
    if (typeof keys === "undefined") continue;
    keyByPathByAddress.delete(absAddress);
    const ledger = ledgerByElement.get(stateElement);
    if (typeof ledger === "undefined") continue;
    for (const [path, key] of keys) {
      const set = ledger.byPath.get(path)?.get(key);
      if (typeof set !== "undefined") {
        set.delete(absAddress);
      }
    }
  }
}

/**
 * The diff moved `listIndex` from `oldIndex` to `newIndex`: move its `$eqIndex` subscriptions to the
 * new key, and enqueue a row only when the last written value of its path equals the old or the new index
 * (only then can `$eqIndex` change its answer). Called from syncListIndexes before the drain applies the diff.
 */
export function rekeyIndexSubscriptions(listIndex: IListIndex, oldIndex: number, newIndex: number): void {
  if (!anyRegistered) return;
  const entries = indexKeyedByListIndex.get(listIndex);
  if (typeof entries === "undefined") return;
  for (const { stateElement, path, absAddress } of entries) {
    const ledger = ledgerByElement.get(stateElement);
    if (typeof ledger === "undefined") continue;
    const keys = keyByPathByAddress.get(absAddress);
    if (typeof keys === "undefined" || !keys.has(path)) continue;
    const keyMap = keyMapOf(ledger, path);
    keyMap.get(oldIndex)?.delete(absAddress);
    let set = keyMap.get(newIndex);
    if (typeof set === "undefined") keyMap.set(newIndex, set = new Set());
    set.add(absAddress);
    keys.set(path, newIndex);
    const last = ledger.lastValue.get(path);
    if (Object.is(last, oldIndex) || Object.is(last, newIndex)) {
      dirtyCacheEntryByAbsoluteStateAddress(absAddress);
      getUpdater().enqueueAbsoluteAddress(absAddress, null);
    }
  }
}

/** Test aid: how many row addresses are subscribed under `path` in this state. */
export function countKeyedSubscriptions(stateElement: IStateElement, path: string): number {
  const keyMap = ledgerByElement.get(stateElement)?.byPath.get(path);
  if (typeof keyMap === "undefined") return 0;
  let n = 0;
  for (const set of keyMap.values()) n += set.size;
  return n;
}
