// Survey §11 (round 4) item 2: make `$eqIndex` O(1) per write and per diff for the innermost
// list level. Instead of subscribing every row under its index and re-keying each moved row
// when the diff shifts indexes (4 ms over 10,999 rows, §10.10), one "index watcher" is kept
// per list (keyed by the list's IListIndex[] array): a write to `path` enqueues the rows at
// indexes[old] and indexes[new]; a diff moves the watcher from the old array to the new one
// and enqueues only the row that was at the last value and the row that is now there. Outer
// levels (`level < wildcardCount`) keep the per-row subscription. Applied on top of the ported
// keyed subscription (copy the repository's dependency/keyedDependency.ts and proxy/traps/get.ts
// into the sandbox first). Every replacement asserts that its anchor exists exactly once.
//   node scripts/research/indexWatcherPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: indexWatcherPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// 1. keyedDependency: index watchers per list
await patch('dependency/keyedDependency.ts', 'registerIndexWatcher', [
  [`import { IAbsoluteStateAddress } from "../address/types";`,
   `import { IAbsoluteStateAddress, IPathInfo } from "../address/types";
import { createStateAddress } from "../address/StateAddress";
import { liftAddress } from "../address/liftAddress";
import { isRetiredListIndex } from "../list/listIndexesByList";`],
  [`// 一度も登録が無ければ差分側のフックは Map 参照すら行わない
let anyRegistered = false;`,
   `// 一度も登録が無ければ差分側のフックは Map 参照すら行わない
let anyRegistered = false;

/**
 * リスト単位の index 監視（\`$eqIndex\` の最内段）。行ごとの購読を持たず、書き込みは
 * \`indexes[旧値]\` と \`indexes[新値]\` の行を、差分は「最後の値の位置にいた行と来た行」だけを
 * enqueue する。差分がリストの listIndex 配列を作り直したら監視を新しい配列へ移す。
 */
interface IIndexWatcher {
  readonly stateElement: IStateElement;
  readonly path: string;
  /** 監視中のリストの listIndex 配列（差分で付け替わる） */
  indexes: IListIndex[];
  /** この監視を張った getter のパス（同じリストの複数 getter を 1 監視で扱う） */
  readonly getters: Set<IPathInfo>;
}
const watchersByElement = new WeakMap<IStateElement, Map<string, Set<IIndexWatcher>>>();
const watchersByIndexes = new WeakMap<IListIndex[], IIndexWatcher[]>();`],
  [`export function hasKeyedDependents(stateElement: IStateElement, path: string): boolean {
  return ledgerByElement.get(stateElement)?.byPath.has(path) === true;
}`,
   `export function hasKeyedDependents(stateElement: IStateElement, path: string): boolean {
  return ledgerByElement.get(stateElement)?.byPath.has(path) === true
    || watchersByElement.get(stateElement)?.has(path) === true;
}

/** \`$eqIndex\` の最内段: リスト（listIndex 配列）単位の監視を 1 つ登録し、getter のパスを足す */
export function registerIndexWatcher(
  stateElement: IStateElement,
  path: string,
  getterPathInfo: IPathInfo,
  indexes: IListIndex[],
  current: unknown,
): void {
  anyRegistered = true;
  ledgerOf(stateElement).lastValue.set(path, current);
  let byPath = watchersByElement.get(stateElement);
  if (typeof byPath === "undefined") {
    watchersByElement.set(stateElement, byPath = new Map());
  }
  let watchers = byPath.get(path);
  if (typeof watchers === "undefined") {
    byPath.set(path, watchers = new Set());
  }
  let byList = watchersByIndexes.get(indexes);
  let watcher: IIndexWatcher | undefined;
  if (typeof byList === "undefined") {
    watchersByIndexes.set(indexes, byList = []);
  } else {
    watcher = byList.find((w) => w.stateElement === stateElement && w.path === path);
  }
  if (typeof watcher === "undefined") {
    watcher = { stateElement, path, indexes, getters: new Set() };
    byList.push(watcher);
    watchers.add(watcher);
  }
  watcher.getters.add(getterPathInfo);
}

function watchedRowsAt(watcher: IIndexWatcher, key: unknown, out: IAbsoluteStateAddress[]): void {
  if (typeof key !== "number") {
    return;
  }
  const listIndex = watcher.indexes[key];
  if (typeof listIndex === "undefined") {
    return;
  }
  for (const getterPathInfo of watcher.getters) {
    out.push(liftAddress(watcher.stateElement, createStateAddress(getterPathInfo, listIndex)));
  }
}

/**
 * 差分がリストの listIndex 配列を \`oldIndexes\` → \`newIndexes\` に付け替えた: 監視を新しい配列へ移し、
 * \`path\` の最後の値の位置にいた行と来た行（違うときだけ）を dirty 化して enqueue する。
 * 同じ差分の 2 回目の呼び出し（キャッシュ命中）は旧配列に監視が無いので何もしない。
 */
export function moveIndexWatchers(oldIndexes: IListIndex[], newIndexes: IListIndex[]): void {
  if (!anyRegistered || oldIndexes === newIndexes) {
    return;
  }
  const watchers = watchersByIndexes.get(oldIndexes);
  if (typeof watchers === "undefined") {
    return;
  }
  watchersByIndexes.delete(oldIndexes);
  const existing = watchersByIndexes.get(newIndexes);
  watchersByIndexes.set(newIndexes, typeof existing === "undefined" ? watchers : existing.concat(watchers));
  for (const watcher of watchers) {
    watcher.indexes = newIndexes;
    const last = ledgerOf(watcher.stateElement).lastValue.get(watcher.path);
    if (typeof last !== "number") {
      continue;
    }
    const before = oldIndexes[last];
    const after = newIndexes[last];
    if (before === after) {
      continue;
    }
    for (const listIndex of [before, after]) {
      if (typeof listIndex === "undefined" || isRetiredListIndex(listIndex)) {
        continue;
      }
      for (const getterPathInfo of watcher.getters) {
        const absAddress = liftAddress(watcher.stateElement, createStateAddress(getterPathInfo, listIndex));
        dirtyCacheEntryByAbsoluteStateAddress(absAddress);
        getUpdater().enqueueAbsoluteAddress(absAddress, null);
      }
    }
  }
}`],
  // keyedDependents: watchers contribute the rows at the old and the new index
  [`  const ledger = ledgerByElement.get(stateElement);
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
  return out;`,
   `  const ledger = ledgerByElement.get(stateElement);
  const keyMap = ledger?.byPath.get(path);
  const watchers = watchersByElement.get(stateElement)?.get(path);
  if (typeof ledger === "undefined" || (typeof keyMap === "undefined" && typeof watchers === "undefined")) {
    return EMPTY;
  }
  ledger.lastValue.set(path, newKey);
  const out: IAbsoluteStateAddress[] = [];
  const newDiffers = !hasOldKey || !Object.is(oldKey, newKey);
  if (typeof keyMap !== "undefined") {
    if (hasOldKey) {
      collect(keyMap.get(oldKey), out);
    }
    if (newDiffers) {
      collect(keyMap.get(newKey), out);
    }
  }
  if (typeof watchers !== "undefined") {
    for (const watcher of watchers) {
      if (hasOldKey) {
        watchedRowsAt(watcher, oldKey, out);
      }
      if (newDiffers) {
        watchedRowsAt(watcher, newKey, out);
      }
    }
  }
  return out;`],
]);

// 2. get trap: the innermost level registers a list watcher instead of a per-row subscription
await patch('proxy/traps/get.ts', 'registerIndexWatcher', [
  [`import { registerIndexKeyedDependency, registerKeyedDependency } from "../../dependency/keyedDependency";`,
   `import { registerIndexKeyedDependency, registerIndexWatcher, registerKeyedDependency } from "../../dependency/keyedDependency";
import { getListIndexesByList } from "../../list/listIndexesByList";`],
  [`            handler.beginUntrack();
            let current: unknown;
            try {
              current = receiver[path];
            } finally {
              handler.endUntrack();
            }
            if (handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerIndexKeyedDependency(handler.stateElement, path, levelListIndex, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, levelListIndex.index);`,
   `            // 最内段（getter 自身の行の段）はリスト単位の監視で O(1)、外側の段は行ごとの購読
            const innermost = level === lastAddress.pathInfo.wildcardCount;
            handler.beginUntrack();
            let current: unknown;
            let listValue: unknown;
            try {
              current = receiver[path];
              if (innermost) {
                listValue = receiver[lastAddress.pathInfo.wildcardParentPaths[level - 1]];
              }
            } finally {
              handler.endUntrack();
            }
            if (handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              const indexes = innermost && Array.isArray(listValue) ? getListIndexesByList(listValue) : null;
              if (indexes !== null && indexes[levelListIndex.index] === levelListIndex) {
                registerIndexWatcher(handler.stateElement, path, lastAddress.pathInfo, indexes, current);
              } else {
                registerIndexKeyedDependency(handler.stateElement, path, levelListIndex, liftAddressForKeyed(handler.stateElement, lastAddress), current);
              }
            }
            return Object.is(current, levelListIndex.index);`],
]);

// 3. list diff: move the watchers with the list's index array
await patch('list/createListDiff.ts', 'moveIndexWatchers', [
  [`import { dropKeyedSubscriptionsByListIndex, rekeyIndexSubscriptions } from "../dependency/keyedDependency";`,
   `import { dropKeyedSubscriptionsByListIndex, moveIndexWatchers, rekeyIndexSubscriptions } from "../dependency/keyedDependency";`],
  [`  reviveListIndexes(diff.newIndexes);`,
   `  reviveListIndexes(diff.newIndexes);
  // \`$eqIndex\` の最内段の監視は listIndex 配列に付く: 配列が変わったら移し、最後の値の位置の行を enqueue
  moveIndexWatchers(diff.oldIndexes, diff.newIndexes);`],
]);
