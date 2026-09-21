// S3, second slice (wiring design §8-2): after the stream slice (s3StreamSlicePatch.mjs), move the
// remaining recursion / dcc / watch hot-path edges out of the core into per-feature hook modules,
// attached per state element by the declaration that requires them (D12) and gated by one
// `addressHooks === null` check on the hot path:
//   recursion (8 edges): the `**` binding in the get trap, the `**` forms of `$getAll` / `$setAll`,
//     the readonly guard for recursive getters in setByAddress → recursion/addressHooks.ts
//     (`$trackDependency`'s `**` rejection stays in the core as a one-liner on define's constant,
//     because it applies to every state, declared or not)
//   dcc (2 edges): the bindable event after a write / `$postUpdate` → dcc/addressHooks.ts (`written`)
//   watch (1 edge): the previous-value ledger for `$watch` / `$scan` (write + swap) → watch/addressHooks.ts
// The core's hook bundle grows the kinds the remaining slices need (readMissing / writeMissing /
// indexShift / handlerScope / updated) so the scopes slice only adds feature modules and receptacles.
// Applied to a sandbox copy of packages/state that already carries the stream slice; every anchor
// must match exactly the expected number of times.
//   node scripts/research/s3FeatureSlicePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s3FeatureSlicePatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement, expected = 1] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== expected) throw new Error(`${rel}: anchor found ${count} times (expected ${expected}): ${anchor.slice(0, 70)}`);
    code = expected === 1 ? code.replace(anchor, () => replacement) : code.replaceAll(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
// new files are written once: a later slice patches them (the scopes slice adds a hook kind to
// core/addressHooks.ts), so a re-run must not overwrite what it finds
async function writeOnce(rel, content) {
  const file = join(pkg, rel);
  const existing = await readFile(file, 'utf8').catch(() => null);
  if (existing !== null && existing.replaceAll('\r\n', '\n').includes(content.slice(0, 200))) { console.log('already written', rel); return; }
  await writeFile(file, content);
  console.log('wrote', rel);
}

// 1. the receptacle, now with every hook kind the remaining slices need
await writeOnce('src/core/addressHooks.ts', `/**
 * core/addressHooks.ts — 読み書き境界の受け口（設計案 H1、S3）。
 *
 * 機能は \`install()\` でレジストリに hook 実装を置く（hot path には触れない）。state 要素は
 * 宣言が要求する機能の hook だけを \`attachAddressHooks\` で自分に付け、core の各受け口は
 * \`stateElement.addressHooks\` が null なら判定 1 回で抜ける
 * （調査 §10.8: 大域配列の走査は読み +40%、state ごとの門なら +0.1 ns）。
 * 宣言が要求する機能が未 install なら \`requireFeature\` が宣言時に throw する（readiness barrier、D13）。
 *
 * 受け口（core 側の呼び出し点）:
 *   read         getByAddress の先頭（キャッシュより前）。名前空間・マーカーなど raw state に無い値を答える
 *   readMissing  getByAddress で「ツリーにそのキーが無い」と分かった点（親の値つき。親が無ければ null）
 *   write        setByAddress の先頭。書き込みを奪うか、禁止して throw する
 *   writeMissing setByAddress の fast path で「親にそのキーが無い」と分かった点（公開 getter への書き込み）
 *   writeObserve 旧値が分かった点（同値ガードの直後）。旧値の台帳を持つ機能が読む
 *   written      書き込み・\`$postUpdate\` の後。観測面へ通知する機能が読む
 *   swapped      要素の入れ替えで行が動いた点（旧値の台帳を行に追従させる）
 *   get          get トラップの文字列プロパティ先頭。API・名前空間・パスの翻訳を答える
 *   indexShift   \`$n\` の解決点。スコープ相対の段ずれを足す
 *   handlerScope イベントハンドラの添字の段数を決める点
 *   updated      \`$updatedCallback\` の後。相対配送する機能が読む
 */
import type { IAbsoluteStateAddress, IPathInfo, IStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import type { ILoopContext } from "../list/types";
import type { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";

export const NOT_HANDLED: unique symbol = Symbol("wcs.notHandled");
export type ReadHook = (stateElement: IStateElement, address: IStateAddress, receiver: any, handler: IStateHandler) => unknown;
export type ReadMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object | null, receiver: any, handler: IStateHandler) => unknown;
export type WriteHook = (stateElement: IStateElement, address: IStateAddress, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type WriteMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object, key: PropertyKey, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type WriteObserveHook = (stateElement: IStateElement, path: string, absAddress: IAbsoluteStateAddress, oldValue: unknown, hasOldValue: boolean) => void;
export type WrittenHook = (stateElement: IStateElement, pathInfo: IPathInfo, detail?: { readonly value: unknown }) => void;
export type SwappedHook = (stateElement: IStateElement, elementAbsAddress: IAbsoluteStateAddress, displacedAbsAddress: IAbsoluteStateAddress) => void;
export type GetHook = (handler: IStateHandler, prop: string, receiver: any, target: object) => unknown;
export type IndexShiftHook = (handler: IStateHandler, lastAddress: IStateAddress) => number;
export type HandlerScopeHook = (stateElement: IStateElement, node: Node, rootNode: Node, loopContext: ILoopContext, wildcardCount: number) => number;
export type UpdatedHook = (stateElement: IStateElement, refs: IAbsoluteStateAddress[], receiver: any) => void;

export interface IAddressHooks {
  readonly read?: ReadHook;
  readonly readMissing?: ReadMissingHook;
  readonly write?: WriteHook;
  readonly writeMissing?: WriteMissingHook;
  readonly writeObserve?: WriteObserveHook;
  readonly written?: WrittenHook;
  readonly swapped?: SwappedHook;
  readonly get?: GetHook;
  readonly indexShift?: IndexShiftHook;
  readonly handlerScope?: HandlerScopeHook;
  readonly updated?: UpdatedHook;
}
/** state 要素に付いた hook 群（種類ごとに、機能の登録順） */
export type IAttachedHooks = { readonly [K in keyof Required<IAddressHooks>]: NonNullable<IAddressHooks[K]>[] };

const HOOK_KINDS: readonly (keyof IAddressHooks)[] = [
  "read", "readMissing", "write", "writeMissing", "writeObserve", "written", "swapped",
  "get", "indexShift", "handlerScope", "updated",
];

const registry = new Map<string, IAddressHooks>();

/** 機能の install が呼ぶ（冪等）。hot path には触れない */
export function registerFeatureHooks(feature: string, hooks: IAddressHooks): void {
  registry.set(feature, hooks);
}

export function isFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

/** 宣言 \`declaration\` が機能 \`feature\` を要求した: 未 install なら名指しで throw する（D13） */
export function requireFeature(feature: string, declaration: string): IAddressHooks {
  const hooks = registry.get(feature);
  if (typeof hooks === "undefined") {
    raiseError(\`[wcs/feature-not-installed] "\${declaration}" needs the "\${feature}" feature: install it before defining the state.\`);
  }
  return hooks;
}

export function createAttachedHooks(): IAttachedHooks {
  return {
    read: [], readMissing: [], write: [], writeMissing: [], writeObserve: [], written: [], swapped: [],
    get: [], indexShift: [], handlerScope: [], updated: [],
  };
}

/** \`hooks\` を \`attached\` に足す（同じ実装は 1 回だけ） */
export function appendHooks(attached: IAttachedHooks, hooks: IAddressHooks): void {
  for (let i = 0; i < HOOK_KINDS.length; i++) {
    const kind = HOOK_KINDS[i];
    const fn = hooks[kind];
    if (typeof fn === "undefined") continue;
    const list = attached[kind] as unknown[];
    if (!list.includes(fn)) list.push(fn);
  }
}

/** テスト・モック用: 機能の hook 群だけを持つ束を作る */
export function createAttachedHooksFrom(...hooksList: IAddressHooks[]): IAttachedHooks {
  const attached = createAttachedHooks();
  for (const hooks of hooksList) appendHooks(attached, hooks);
  return attached;
}
`);
console.log('wrote src/core/addressHooks.ts');

// 2. recursion feature hooks
await writeOnce('src/recursion/addressHooks.ts', `/**
 * recursion/addressHooks.ts — \`$recursion\` を宣言した state に付く hook（設計案 H1、S3）。
 * 従来 core（get トラップ・\`$getAll\` / \`$setAll\`・setByAddress）が直接 import していた \`**\` の
 * 束縛・合併形・書き込み禁止をここへ移し、宣言の無い state では一切走らない。
 * （\`$trackDependency\` の \`**\` 拒否は宣言の有無に関わらないので core に残る）
 */
import { getResolvedAddress } from "../address/ResolvedAddress";
import { createStateAddress } from "../address/StateAddress";
import { IAddressHooks, NOT_HANDLED, registerFeatureHooks } from "../core/addressHooks";
import { getAll } from "../proxy/apis/getAll";
import { ISetAllOptions, setAll } from "../proxy/apis/setAll";
import { getByAddress } from "../proxy/methods/getByAddress";
import { getListIndex } from "../proxy/methods/getListIndex";
import { raiseError } from "../raiseError";
import { bindRecursivePath } from "./bind";
import { hasRecursionWildcard } from "./expand";
import { getAllRecursive } from "./getAllRecursive";
import { setAllRecursive } from "./setAllRecursive";

// hook は要素の寿命の間は付いたまま（再セットで \`$recursion\` が消えても外れない）ので、
// 宣言が消えた後は \`hasRecursion\` の boolean 判定 1 個で core と同じ経路へ戻す
export const recursionAddressHooks: IAddressHooks = {
  // 再帰 getter の展開形（\`nodes.*.children.*.total\`）とその値の内側への書き込みは、\`**\` を
  // 含まないので \`setAllRecursive\` の読み取り専用検査を通らない。未実体化なら fast path が
  // 「親オブジェクトの未存在キー」として行オブジェクトへ素の値を書き、代入値を \`dirty:false\` で
  // キャッシュに載せる — ノードが汚れ、実体化後も getter が評価されず、深さ 0 の集計まで
  // 巻き込む（レビュー P18 で実測）。読み側の遅延実体化（getByAddress の E5）と対称に、書き側はここで止める
  write(stateElement, address) {
    if (stateElement.hasRecursion !== true) {
      return NOT_HANDLED;
    }
    const owner = stateElement.recursionRegistry!.recursiveGetterOwningPath(address.pathInfo);
    if (owner !== null) {
      raiseError(
        \`[wcs/recursion-readonly] "\${address.pathInfo.path}" writes into the recursive getter "\${owner}" \` +
        \`(this path is that getter at one depth, or a path inside the value it derives), which has \` +
        \`no setter. Write the values it derives from instead.\`
      );
    }
    return NOT_HANDLED;
  },
  get(handler, prop, receiver, target) {
    if (handler.stateElement.hasRecursion !== true) {
      return NOT_HANDLED;
    }
    if (prop === "$getAll") {
      // オーサリング層の \`**\`。省略形は「いま評価している深さ」に束縛し、\`[]\` 明示は
      // 全深さの合併になる（設計書 §6-2）。部分接頭辞は \`**\` に対して定義できない。
      return (path: string, indexes?: number[]): any[] => {
        if (hasRecursionWildcard(path)) {
          if (typeof indexes === "undefined") {
            path = bindRecursivePath(handler.stateElement, handler, path);
          } else {
            // アンカー照合と添字の形の検査は合併形の側で行う（判定順を静的側と揃えるため）
            return getAllRecursive(target, receiver, handler, path, indexes);
          }
        }
        return getAll(target, prop, receiver, handler)(path, indexes);
      };
    }
    if (prop === "$setAll") {
      // 書き側は \`[]\` のブロードキャストだけを受け付ける（形の検査は列挙より前に行い、
      // 1 件も書かないことを保証する。設計 §7-3）
      return (path: string, indexes: number[], value: any, options?: ISetAllOptions): number => {
        if (hasRecursionWildcard(path)) {
          return setAllRecursive(target, receiver, handler, path, indexes, value, options);
        }
        return setAll(target, prop, receiver, handler)(path, indexes, value, options);
      };
    }
    if (prop.charCodeAt(0) !== 36 /* '$' */ && hasRecursionWildcard(prop)) {
      // オーサリング層の \`**\` を、いま評価している再帰 getter の深さへ束縛して通常解決する
      const resolvedAddress = getResolvedAddress(bindRecursivePath(handler.stateElement, handler, prop));
      const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
      return getByAddress(target, createStateAddress(resolvedAddress.pathInfo, listIndex), receiver, handler);
    }
    return NOT_HANDLED;
  },
};

let installed = false;
/** 冪等。full エントリでは State が \`$recursion\` の宣言時に呼ぶ（分割エントリでは \`install\` が担う） */
export function installRecursionHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("recursion", recursionAddressHooks);
}
`);

// 3. dcc feature hooks
await writeOnce('src/dcc/addressHooks.ts', `/**
 * dcc/addressHooks.ts — \`$bindables\` を持つ DCC の state に付く hook（設計案 H1、S3）。
 * 書き込み・\`$postUpdate\` の後の bindable イベント dispatch を core から移し、
 * \`$bindables\` の無い state では一切走らない。
 */
import { IAddressHooks, registerFeatureHooks } from "../core/addressHooks";
import { dispatchBindableEvent } from "./dispatchBindableEvent";

export const dccAddressHooks: IAddressHooks = {
  // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
  written: dispatchBindableEvent,
};

let installed = false;
/** 冪等。full エントリでは State が \`$bindables\` の束ね先になった時点で呼ぶ */
export function installDccHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("dcc", dccAddressHooks);
}
`);

// 4. watch feature hooks (the previous-value ledger, read by $watch and $scan's from)
await writeOnce('src/watch/addressHooks.ts', `/**
 * watch/addressHooks.ts — \`$watch\` / \`$scan\` を宣言した state に付く hook（設計案 H1、S3）。
 * 宣言済みパスの \`prev\` 台帳（prevValues.ts）への記録を core（setByAddress）から移し、
 * どちらも宣言しない state では一切走らない。台帳を読むのは \`$watch\`
 * （docs/state-watch-hook-design.md §4-1）と \`$scan\` の \`from\`（docs/state-scan-design.md §2-1）。
 */
import { IAddressHooks } from "../core/addressHooks";
import { getPrevValue, hasPrevValue, recordPrevValue } from "./prevValues";

export const watchAddressHooks: IAddressHooks = {
  // same-value guard が既に読んだ旧値だけを使い、そのための追加読みはしない
  writeObserve(stateElement, path, absAddress, oldValue, hasOldValue) {
    if (!hasOldValue) {
      return;
    }
    const watchPaths = stateElement.watchPaths;
    const scanPaths = stateElement.scanPaths;
    if (watchPaths?.has(path) === true || scanPaths?.has(path) === true) {
      recordPrevValue(absAddress, oldValue);
    }
  },
  // 要素の入れ替えで行が動いた: 旧値の台帳を行に追従させる
  swapped(_stateElement, elementAbsAddress, displacedAbsAddress) {
    if (hasPrevValue(displacedAbsAddress)) {
      recordPrevValue(elementAbsAddress, getPrevValue(displacedAbsAddress));
    }
  },
};
`);

await patch('src/watch/watchRuntime.ts', 'registerFeatureHooks("watch"', [
  [`import { clearPrevValues, getPrevValue } from "./prevValues";\n`,
   `import { clearPrevValues, getPrevValue } from "./prevValues";\nimport { registerFeatureHooks } from "../core/addressHooks";\nimport { watchAddressHooks } from "./addressHooks";\n`],
  [`  watchRuntimeInstalled = true;\n  registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);\n`,
   `  watchRuntimeInstalled = true;\n  registerFeatureHooks("watch", watchAddressHooks);\n  registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);\n`],
]);

// 5. core receptacles
await patch('src/proxy/methods/setByAddress.ts', 'notifyWritten(', [
  [`import { dispatchBindableEvent } from "../../dcc/dispatchBindableEvent";\n`, ``],
  [`import { getPrevValue, hasPrevValue, recordPrevValue } from "../../watch/prevValues";\n`, ``],
  [` * どちらも未宣言なら \`watchPaths\` / \`scanPaths\` の null 判定 2 個で抜ける（watch 設計書 §10）。\n */\nfunction recordDeclaredPrevValue(\n  stateElement: IStateHandler["stateElement"],\n  path: string,\n  absAddress: IAbsoluteStateAddress,\n  oldValue: unknown,\n  hasOldValue: boolean,\n): void {\n  if (!hasOldValue) {\n    return;\n  }\n  const watchPaths = stateElement.watchPaths;\n  const scanPaths = stateElement.scanPaths;\n  if (watchPaths?.has(path) === true || scanPaths?.has(path) === true) {\n    recordPrevValue(absAddress, oldValue);\n  }\n}\n`,
   ` * 台帳の実体は watch/addressHooks.ts の writeObserve hook（\`$watch\` / \`$scan\` を宣言した state にだけ付く）。\n * 宣言の無い state は \`addressHooks\` の null 判定 1 個で抜ける。\n */\nfunction recordDeclaredPrevValue(\n  stateElement: IStateHandler["stateElement"],\n  path: string,\n  absAddress: IAbsoluteStateAddress,\n  oldValue: unknown,\n  hasOldValue: boolean,\n): void {\n  const hooks = stateElement.addressHooks;\n  if (hooks) {\n    const observers = hooks.writeObserve;\n    for (let i = 0; i < observers.length; i++) {\n      observers[i](stateElement, path, absAddress, oldValue, hasOldValue);\n    }\n  }\n}\n\n// 書き込み・入れ替えの後の通知（設計案 H1 の written / swapped）: 観測面を持つ機能（DCC の\n// bindable イベント・watch の旧値台帳）が state に付けた hook だけを呼ぶ\nfunction notifyWritten(stateElement: IStateHandler["stateElement"], pathInfo: IStateAddress["pathInfo"], detail?: { readonly value: unknown }): void {\n  const hooks = stateElement.addressHooks;\n  if (hooks) {\n    const written = hooks.written;\n    for (let i = 0; i < written.length; i++) {\n      written[i](stateElement, pathInfo, detail);\n    }\n  }\n}\n\nfunction notifySwapped(stateElement: IStateHandler["stateElement"], elementAbsAddress: IAbsoluteStateAddress, displacedAbsAddress: IAbsoluteStateAddress): void {\n  const hooks = stateElement.addressHooks;\n  if (hooks) {\n    const swapped = hooks.swapped;\n    for (let i = 0; i < swapped.length; i++) {\n      swapped[i](stateElement, elementAbsAddress, displacedAbsAddress);\n    }\n  }\n}\n`],
  [`      if (hasPrevValue(displacedAbsAddress)) {\n        recordPrevValue(elementAbsAddress, getPrevValue(displacedAbsAddress));\n      }\n`,
   `      notifySwapped(stateElement, elementAbsAddress, displacedAbsAddress);\n`],
  [`  // 再帰 getter の展開形（\`nodes.*.children.*.total\`）とその値の内側への書き込みは、\`**\` を\n  // 含まないので \`setAllRecursive\` の読み取り専用検査を通らない。未実体化なら下の fast path が\n  // 「親オブジェクトの未存在キー」として行オブジェクトへ素の値を書き、代入値を \`dirty:false\` で\n  // キャッシュに載せる — ノードが汚れ、実体化後も getter が評価されず、深さ 0 の集計まで\n  // 巻き込む（レビュー P18 で実測）。実体化後は \`Reflect.set\` が false を返すだけの無言 no-op。\n  // 読み側の遅延実体化（getByAddress の E5）と対称に、書き側はここで止める。\n  // 宣言の無い state は boolean 判定 1 個で抜ける（D18）\n  if (stateElement.hasRecursion === true) {\n    const owner = stateElement.recursionRegistry!.recursiveGetterOwningPath(address.pathInfo);\n    if (owner !== null) {\n      raiseError(\n        \`[wcs/recursion-readonly] "\${path}" writes into the recursive getter "\${owner}" \` +\n        \`(this path is that getter at one depth, or a path inside the value it derives), which has \` +\n        \`no setter. Write the values it derives from instead.\`\n      );\n    }\n  }\n`,
   `  // 再帰 getter への書き込み禁止（[wcs/recursion-readonly]）は recursion/addressHooks.ts の write hook が担う\n`],
  [`        // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）\n        dispatchBindableEvent(stateElement, address.pathInfo, { value });\n`,
   `        notifyWritten(stateElement, address.pathInfo, { value });\n`],
  [`    // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）\n    dispatchBindableEvent(stateElement, address.pathInfo, { value });\n`,
   `    notifyWritten(stateElement, address.pathInfo, { value });\n`],
]);

await patch('src/proxy/apis/postUpdate.ts', 'hooks.written', [
  [`import { dispatchBindableEvent } from "../../dcc/dispatchBindableEvent";\n`, ``],
  [`    // DCC bindable イベントディスパッチ。$postUpdate は in-place 変異を通知する正規の idiom で、\n    // set トラップを通らない変更が観測面に出る唯一の経路なので、ここでも撃つ\n    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1）。\n    dispatchBindableEvent(stateElement, address.pathInfo);\n`,
   `    // $postUpdate は in-place 変異を通知する正規の idiom で、set トラップを通らない変更が観測面に\n    // 出る唯一の経路なので、書き込み後の hook（DCC の bindable イベント等）をここでも撃つ\n    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1）。\n    const hooks = stateElement.addressHooks;\n    if (hooks) {\n      const written = hooks.written;\n      for (let i = 0; i < written.length; i++) {\n        written[i](stateElement, address.pathInfo);\n      }\n    }\n`],
]);

await patch('src/proxy/traps/get.ts', 'getHooks[i](handler, prop, receiver, target)', [
  [`import { bindRecursivePath } from "../../recursion/bind";\nimport { hasRecursionWildcard } from "../../recursion/expand";\n`, ``],
  [`        const handled = getHooks[i](handler, prop, receiver);\n`, `        const handled = getHooks[i](handler, prop, receiver, target);\n`],
  [`    // オーサリング層の \`**\` を、いま評価している再帰 getter の深さへ束縛する。\n    // 宣言の無い state は boolean 判定 1 個で抜ける（D18 の形）。\n    const path = (handler.stateElement?.hasRecursion === true && hasRecursionWildcard(prop))\n      ? bindRecursivePath(handler.stateElement, handler, prop)\n      : prop;\n    const resolvedAddress = getResolvedAddress(path);\n`,
   `    // オーサリング層の \`**\`（再帰 getter の深さへの束縛）は recursion/addressHooks.ts の get hook が上で受けている\n    const resolvedAddress = getResolvedAddress(prop);\n`],
]);

await patch('src/proxy/apis/getAll.ts', 'recursion/addressHooks.ts', [
  [`import { bindRecursivePath } from "../../recursion/bind";\nimport { hasRecursionWildcard } from "../../recursion/expand";\nimport { getAllRecursive } from "../../recursion/getAllRecursive";\n`, ``],
  [`      // オーサリング層の \`**\`。省略形は「いま評価している深さ」に束縛し、\`[]\` 明示は\n      // 全深さの合併になる（設計書 §6-2）。部分接頭辞は \`**\` に対して定義できない。\n      if (handler.stateElement.hasRecursion === true && hasRecursionWildcard(path)) {\n        if (typeof indexes === "undefined") {\n          path = bindRecursivePath(handler.stateElement, handler, path);\n        } else {\n          // アンカー照合と添字の形の検査は合併形の側で行う（判定順を静的側と揃えるため）\n          return getAllRecursive(target, receiver, handler, path, indexes);\n        }\n      }\n`,
   `      // オーサリング層の \`**\`（束縛・合併形）は recursion/addressHooks.ts の get hook が先に受ける\n`],
]);

await patch('src/proxy/apis/setAll.ts', 'recursion/addressHooks.ts', [
  [`import { hasRecursionWildcard } from "../../recursion/expand";\nimport { setAllRecursive } from "../../recursion/setAllRecursive";\n`, ``],
  [`    // オーサリング層の \`**\`。書き側は \`[]\` のブロードキャストだけを受け付ける\n    // （形の検査は列挙より前に行い、1 件も書かないことを保証する。設計 §7-3）。\n    // 宣言の無い state は boolean 判定 1 個で抜ける。\n    if (handler.stateElement.hasRecursion === true && hasRecursionWildcard(path)) {\n      return setAllRecursive(target, receiver, handler, path, indexes, value, options);\n    }\n`,
   `    // オーサリング層の \`**\`（ブロードキャスト形）は recursion/addressHooks.ts の get hook が先に受ける\n`],
]);

await patch('src/proxy/apis/trackDependency.ts', 'RECURSION_WILDCARD', [
  [`import { hasRecursionWildcard } from "../../recursion/expand";\n`, `import { RECURSION_WILDCARD } from "../../define";\n`],
  [`    if (hasRecursionWildcard(path)) {\n`, `    if (path.indexOf(RECURSION_WILDCARD) !== -1) {\n`],
]);

// 6. attachment points on State (D12: the declaration that requires the feature attaches its hooks)
await patch('src/components/State.ts', 'installRecursionHooks()', [
  [`import { RecursionRegistry } from "../recursion/registry";\n`, `import { RecursionRegistry } from "../recursion/registry";\nimport { installRecursionHooks } from "../recursion/addressHooks";\n`],
  [`import { startWatch } from "../watch/watchRuntime";\n`, `import { installWatchRuntime, startWatch } from "../watch/watchRuntime";\n`],
  [`import { defineDCC } from "../dcc/defineDCC";\n`, `import { defineDCC } from "../dcc/defineDCC";\nimport { installDccHooks } from "../dcc/addressHooks";\n`],
  // the stream slice imports its declaration name on its own line; the other declaration names join it
  [`import { STATE_STREAMS_NAME as STATE_STREAMS_DECLARATION } from "../define";\n`, `import { STATE_STREAMS_NAME as STATE_STREAMS_DECLARATION, STATE_RECURSION_NAME, STATE_WATCH_NAME, STATE_SCAN_NAME, STATE_BINDABLES_NAME } from "../define";\n`],
  [`    this._recursionRegistry = recursionRegistry;\n`,
   `    this._recursionRegistry = recursionRegistry;\n    if (recursionRegistry !== null) {\n      // \`$recursion\` を宣言した state にだけ再帰の hook（\`**\` の束縛・再帰 getter の書き込み禁止）を付ける\n      installRecursionHooks();\n      this.attachAddressHooks("recursion", STATE_RECURSION_NAME);\n    }\n`],
  [`    this._watchPaths = processWatchDeclaration(this, value);\n`,
   `    this._watchPaths = processWatchDeclaration(this, value);\n    if (this._watchPaths !== null || this._scanPaths !== null) {\n      // 旧値の台帳（\`$watch\` の prev・\`$scan\` の from）は watch 機能の hook が書き込み時に記録する\n      installWatchRuntime();\n      this.attachAddressHooks("watch", this._watchPaths !== null ? STATE_WATCH_NAME : STATE_SCAN_NAME);\n    }\n`],
  [`  setBindableEventMap(map: Record<string, string>): void {\n    this._bindableEventMap = map;\n  }\n`,
   `  setBindableEventMap(map: Record<string, string>): void {\n    this._bindableEventMap = map;\n    // \`$bindables\` の束ね先になった: 書き込み後の bindable イベントを撃つ hook を付ける\n    installDccHooks();\n    this.attachAddressHooks("dcc", STATE_BINDABLES_NAME);\n  }\n`],
]);

// a volume's `$watch` is merged into the root's watchPaths: the root then needs the watch hooks too
await patch('src/components/State.ts', 'attachAddressHooks("watch", STATE_WATCH_NAME);\n  }\n\n  /** ボリュームの $listKeys', [
  [`    this._watchPaths = merged;\n  }\n`,
   `    this._watchPaths = merged;\n    // ルートが \`$watch\` を宣言していなくても、合流した watch パスの旧値は同じ hook が記録する\n    installWatchRuntime();\n    this.attachAddressHooks("watch", STATE_WATCH_NAME);\n  }\n`],
]);

// 7. test-side: mocks that expect feature behaviour carry the feature's hooks
await patch('__tests__/stream.argsTrace.test.ts', 'createAttachedHooksFrom', [
  [`import { streamAddressHooks } from "../src/stream/addressHooks";\n`, `import { streamAddressHooks } from "../src/stream/addressHooks";\nimport { createAttachedHooksFrom } from "../src/core/addressHooks";\n`],
  [`    addressHooks: { read: [streamAddressHooks.read!], write: [], get: [streamAddressHooks.get!] },\n`, `    addressHooks: createAttachedHooksFrom(streamAddressHooks),\n`],
]);
await patch('__tests__/proxy.setByAddress.test.ts', 'dccAddressHooks', [
  [`import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';\n`,
   `import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';\nimport { createAttachedHooksFrom } from '../src/core/addressHooks';\nimport { dccAddressHooks } from '../src/dcc/addressHooks';\n`],
  [`      bindableEventMap: { count: 'x-el:count-changed' },\n    });\n`,
   `      bindableEventMap: { count: 'x-el:count-changed' },\n      addressHooks: createAttachedHooksFrom(dccAddressHooks),\n    });\n`, 2],
  [`        bindableEventMap: { 'cfg.theme': 'cfg-theme-changed' },\n      });\n`,
   `        bindableEventMap: { 'cfg.theme': 'cfg-theme-changed' },\n        addressHooks: createAttachedHooksFrom(dccAddressHooks),\n      });\n`, 2],
]);
console.log('done');
