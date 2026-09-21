// S5, first slice: the five core -> feature edges that are neither an install nor SSR.
// After S3/S4 the coupling audit still counts, besides 7 install edges and 4 SSR edges:
//   * updater/updater.ts -> watch/chainDepth.ts, scan/eventReset.ts: every enqueue told the watch
//     chain counter and the `on` scan's pending reset. They become ENQUEUE LISTENERS registered by
//     the watch / scan installs (the enqueue-side twin of H2's drain listeners). The two are
//     independent, so there is no priority; with neither installed the loop is a length-0 check.
//   * apply/applyChange.ts -> webComponent/completeWebComponent.ts and
//     apply/applyChangeToProperty.ts -> webComponent/preCompletionWrites.ts: bind-component's two
//     ledgers (completed / declared, and the pre-completion write memos). They go behind one
//     receptacle, `core/componentApplyHooks.ts`, which the bind-component install fills. With the
//     feature absent a custom element's property binding is a plain property write and nothing is
//     recorded — the memos only ever had a reader inside bind-component.
//   * apply/applyChangeToFor.ts -> webComponent/mountScope.ts: re-mounting the scopes inside a row
//     that was reused in place. It becomes the 13th per-state hook kind, `rowReused`, on the scopes
//     hooks (a state with no mount has no hooks, so the check is the usual null test).
// Found on the way: `bind-component` had no readiness barrier. With the scopes feature missing,
// `runPreparing` returns null and the attribute was silently ignored (the element became a plain
// state). It now fails by name, inside the try that lands bind-component's other errors (#257).
// Applied to a sandbox copy carrying S3's three slices and S4's eight; anchors must match once.
//   node scripts/research/s5CoreEdgesPatch.mjs <sandbox>/packages/state
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s5CoreEdgesPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
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
async function create(rel, content) {
  const file = join(pkg, rel);
  try { await access(file); console.log('already created', rel); return; } catch { /* create */ }
  await writeFile(file, content);
  console.log('created', rel);
}

// ---------------------------------------------------------------------------------------------
// 1. enqueue listeners (updater -> watch/chainDepth, scan/eventReset)
await patch('src/updater/updater.ts', 'registerEnqueueListener', [
  [`import { noteEnqueueForWatchChain } from "../watch/chainDepth";\nimport { noteEnqueueForScanReset } from "../scan/eventReset";\n`, ``],
  [`const updateBatchListeners: IRegisteredBatchListener[] = [];\n`,
   `const updateBatchListeners: IRegisteredBatchListener[] = [];\n\n` +
   `/**\n` +
   ` * 書き込みの enqueue を見る機能（設計案 H2 の enqueue 側）。\`$watch\` の連鎖深さ（watch/chainDepth.ts）と\n` +
   ` * \`on\` scan の保留 reset（scan/eventReset.ts）が install で登録する。互いに独立なので順序契約は無い。\n` +
   ` * 登録が無ければ enqueue は配列長 0 の判定 1 回で抜ける。\n` +
   ` */\n` +
   `export type EnqueueListener = (absoluteAddress: IAbsoluteStateAddress) => void;\n\n` +
   `const enqueueListeners: EnqueueListener[] = [];\n\n` +
   `/** 機能の install が呼ぶ（冪等 — 同じ listener は 1 回だけ） */\n` +
   `export function registerEnqueueListener(listener: EnqueueListener): void {\n` +
   `  if (!enqueueListeners.includes(listener)) {\n` +
   `    enqueueListeners.push(listener);\n` +
   `  }\n` +
   `}\n`],
  [`    // \`$watch\` ハンドラ実行中の書き込みだけを連鎖としてマークする（watch/chainDepth.ts）。\n` +
   `    // ハンドラ実行中でなければ即 return する葉モジュール呼び出し 1 個のコスト。\n` +
   `    noteEnqueueForWatchChain();\n` +
   `    // \`on\` scan の \`resetOn\` を書き込みの時点で保留する（scan/eventReset.ts）。\n` +
   `    // 該当する宣言がページに無ければ整数比較 1 回で抜ける。\n` +
   `    noteEnqueueForScanReset(absoluteAddress);\n`,
   `    // 書き込みの時点を見る機能（\`$watch\` の連鎖のマーク・\`on\` scan の \`resetOn\` の保留）。\n` +
   `    // install されていなければ配列長 0 の判定 1 回\n` +
   `    for (let i = 0; i < enqueueListeners.length; i++) {\n` +
   `      enqueueListeners[i](absoluteAddress);\n` +
   `    }\n`],
]);
await patch('src/watch/watchRuntime.ts', 'registerEnqueueListener(noteEnqueueForWatchChain)', [
  [`import { registerUpdateBatchListener } from "../updater/updater";\n`,
   `import { registerEnqueueListener, registerUpdateBatchListener } from "../updater/updater";\n`],
  [`import { beginWatchFiring, consumeWatchChainDepth, endWatchFiring } from "./chainDepth";\n`,
   `import { beginWatchFiring, consumeWatchChainDepth, endWatchFiring, noteEnqueueForWatchChain } from "./chainDepth";\n`],
  [`  registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);\n}\n`,
   `  registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);\n` +
   `  // ハンドラ実行中の書き込みだけを連鎖としてマークする（chainDepth.ts）。ハンドラ実行中でなければ即 return\n` +
   `  registerEnqueueListener(noteEnqueueForWatchChain);\n}\n`],
]);
await patch('src/scan/declarations.ts', 'registerEnqueueListener', [
  [`import type { IScanEntry } from "./types";\n`,
   `import type { IScanEntry } from "./types";\nimport { registerEnqueueListener } from "../updater/updater";\nimport { noteEnqueueForScanReset } from "./eventReset";\n`],
  [`  registerDeclarationHooks("scan", scanDeclarationHooks);\n}\n`,
   `  registerDeclarationHooks("scan", scanDeclarationHooks);\n` +
   `  // \`on\` scan の \`resetOn\` を書き込みの時点で保留する（eventReset.ts）。該当する宣言が無ければ整数比較 1 回\n` +
   `  registerEnqueueListener(noteEnqueueForScanReset);\n}\n`],
]);

// ---------------------------------------------------------------------------------------------
// 2. bind-component's ledgers behind one receptacle (apply -> completeWebComponent, preCompletionWrites)
await create('src/core/componentApplyHooks.ts', `/**
 * core/componentApplyHooks.ts — カスタム要素のプロパティ束縛の受け口（設計案 S5）。
 *
 * \`bind-component\` の機能（webComponent/bindComponentLifecycle.ts）が install で置く。apply 側
 * （apply/applyChange.ts・apply/applyChangeToProperty.ts）は、置かれていなければカスタム要素への
 * 束縛も素のプロパティ書き込みとして扱い、何も控えない — 控えの読み手は bind-component の中にしか居ない。
 */

export interface IComponentApplyHooks {
  /** \`bind-component\` の配線が完了した (要素, state プロパティ)。値を運ばない通知チャネルへ切り替える */
  isComplete(element: Element, stateProp: string): boolean;
  /** 宣言済み・未完了。完了前の初期適用は書かない */
  isDeclared(element: Element, stateProp: string): boolean;
  /** 完了前の丸ごと書き込み（\`state: user\`）が置き換える作者のオブジェクトを控える */
  rememberOverwrittenObject(element: Element, prop: string, previous: object): void;
  /** 完了前の部分書き込み（\`state.theme: theme\`）が作者のオブジェクトに作ったキーを控える */
  recordInjectedKey(element: Element, prop: string, key: string): void;
  /** 完了前の部分書き込みが上書きする作者の既存キーの値を控える */
  rememberOverwrittenValue(element: Element, prop: string, key: string, previous: unknown): void;
}

/** 置かれていなければ null（apply 側は判定 1 回で素の書き込みに倒す） */
export let componentApplyHooks: IComponentApplyHooks | null = null;

/** 機能の install が呼ぶ（冪等 — 置き換え） */
export function setComponentApplyHooks(hooks: IComponentApplyHooks | null): void {
  componentApplyHooks = hooks;
}
`);
await patch('src/apply/applyChange.ts', 'componentApplyHooks', [
  [`import { isWebComponentComplete, isWebComponentStatePropDeclared } from "../webComponent/completeWebComponent.js";\n`,
   `import { componentApplyHooks } from "../core/componentApplyHooks.js";\n`],
  [` * webComponent/completeWebComponent.ts の宣言台帳を参照）。v2 では部分規則\n`,
   ` * webComponent/completeWebComponent.ts の宣言台帳を参照 — core/componentApplyHooks.ts 越しに引く）。v2 では部分規則\n`],
  [`function resolveCustomElementApply(binding: IBindingInfo): ApplyChangeFn {\n` +
   `  const element = binding.replaceNode as Element;\n` +
   `  const stateProp = binding.propSegments[0];\n` +
   `  if (isWebComponentComplete(element, stateProp)) {\n` +
   `    return applyChangeToWebComponent;\n` +
   `  }\n` +
   `  if (isWebComponentStatePropDeclared(element, stateProp)) {\n` +
   `    return skipPendingMountWrite;\n` +
   `  }\n` +
   `  return applyChangeToProperty;\n` +
   `}\n`,
   `function resolveCustomElementApply(binding: IBindingInfo): ApplyChangeFn {\n` +
   `  // 完了・宣言の台帳は bind-component の機能が受け口に置く。置かれていなければ素の書き込み\n` +
   `  const hooks = componentApplyHooks;\n` +
   `  if (hooks !== null) {\n` +
   `    const element = binding.replaceNode as Element;\n` +
   `    const stateProp = binding.propSegments[0];\n` +
   `    if (hooks.isComplete(element, stateProp)) {\n` +
   `      return applyChangeToWebComponent;\n` +
   `    }\n` +
   `    if (hooks.isDeclared(element, stateProp)) {\n` +
   `      return skipPendingMountWrite;\n` +
   `    }\n` +
   `  }\n` +
   `  return applyChangeToProperty;\n` +
   `}\n`],
]);
await patch('src/apply/applyChangeToProperty.ts', 'componentApplyHooks', [
  [`import { recordInjectedKey, rememberOverwrittenObject, rememberOverwrittenValue } from "../webComponent/preCompletionWrites";\n`,
   `import { componentApplyHooks } from "../core/componentApplyHooks";\n`],
  [`      // （webComponent/preCompletionWrites.ts）。オブジェクト → オブジェクトの書き込みで\n` +
   `      // 相手がカスタム要素のときだけ台帳に触る（通常の書き込みは typeof 判定で抜ける）。\n` +
   `      if (current !== null && typeof current === 'object'\n`,
   `      // （webComponent/preCompletionWrites.ts — bind-component の機能が core/componentApplyHooks.ts に置く。\n` +
   `      // 置かれていなければ判定 1 回で抜ける）。オブジェクト → オブジェクトの書き込みで\n` +
   `      // 相手がカスタム要素のときだけ台帳に触る（通常の書き込みは typeof 判定で抜ける）。\n` +
   `      if (componentApplyHooks !== null && current !== null && typeof current === 'object'\n`],
  [`        rememberOverwrittenObject(element, firstSegment, current);\n`,
   `        componentApplyHooks.rememberOverwrittenObject(element, firstSegment, current);\n`],
  [`    // （webComponent/preCompletionWrites.ts）\n` +
   `    if (propSegments.length === 2 && typeof subObject === 'object' && subObject !== null\n`,
   `    // （webComponent/preCompletionWrites.ts — core/componentApplyHooks.ts 越し）\n` +
   `    if (componentApplyHooks !== null && propSegments.length === 2 && typeof subObject === 'object' && subObject !== null\n`],
  [`        recordInjectedKey(element, firstSegment, lastSegment);\n`,
   `        componentApplyHooks.recordInjectedKey(element, firstSegment, lastSegment);\n`],
  [`        rememberOverwrittenValue(element, firstSegment, lastSegment, subObject[lastSegment]);\n`,
   `        componentApplyHooks.rememberOverwrittenValue(element, firstSegment, lastSegment, subObject[lastSegment]);\n`],
]);
// the receptacle's implementation lives in its own light module (the two ledgers only), so that a
// unit test — or a page — can put it in place without evaluating the whole lifecycle module
await create('src/webComponent/componentApply.ts', `/**
 * webComponent/componentApply.ts — bind-component の 2 つの台帳（完了・宣言 — completeWebComponent.ts、
 * 完了前の書き込みの控え — preCompletionWrites.ts）を、親スコープの適用が引く受け口
 * （core/componentApplyHooks.ts）の形に束ねたもの。置くのは bindComponentLifecycle.ts の install。
 * 完了前は素のプロパティへ積んで控え、完了後は値を運ばない通知へ切り替える。
 */
import type { IComponentApplyHooks } from "../core/componentApplyHooks";
import { isWebComponentComplete, isWebComponentStatePropDeclared } from "./completeWebComponent";
import { recordInjectedKey, rememberOverwrittenObject, rememberOverwrittenValue } from "./preCompletionWrites";

export const bindComponentApplyHooks: IComponentApplyHooks = {
  isComplete: isWebComponentComplete,
  isDeclared: isWebComponentStatePropDeclared,
  rememberOverwrittenObject,
  recordInjectedKey,
  rememberOverwrittenValue,
};
`);
await patch('src/webComponent/bindComponentLifecycle.ts', 'setComponentApplyHooks', [
  [`import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";\n`,
   `import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";\nimport { setComponentApplyHooks } from "../core/componentApplyHooks";\nimport { bindComponentApplyHooks } from "./componentApply";\n`],
  [`let installed = false;\n/** 冪等。full / auto では \`bootstrapState()\` の \`installVolumeGraft()\` が呼ぶ */\nexport function installBindComponentLifecycle(): void {\n  if (installed) return;\n  installed = true;\n  registerLifecycleHooks("bindComponent", bindComponentLifecycleHooks);\n}\n`,
   `let installed = false;\n/** 冪等。full / auto では \`bootstrapState()\` の \`installVolumeGraft()\` が呼ぶ */\nexport function installBindComponentLifecycle(): void {\n  if (installed) return;\n  installed = true;\n  registerLifecycleHooks("bindComponent", bindComponentLifecycleHooks);\n  // 親スコープの適用が台帳を引く受け口（core/componentApplyHooks.ts）\n  setComponentApplyHooks(bindComponentApplyHooks);\n}\n`],
]);

// ---------------------------------------------------------------------------------------------
// 3. `rowReused`: the 13th per-state hook kind (applyChangeToFor -> mountScope)
await patch('src/core/addressHooks.ts', 'RowReusedHook', [
  [` *   suppressPathDiagnostic  束縛時の未宣言パス診断を黙らせるか（予約済みスロットの配下など）\n`,
   ` *   suppressPathDiagnostic  束縛時の未宣言パス診断を黙らせるか（予約済みスロットの配下など）\n` +
   ` *   rowReused    その場で使い回した行（DOM から外れない）の点。行の中のスコープを新しい listIndex へ張り直す\n`],
  [`import type { IStateHandler } from "../proxy/types";\n`,
   `import type { IStateHandler } from "../proxy/types";\nimport type { IContent } from "../structural/types";\n`],
  [`export type SuppressPathDiagnosticHook = (stateElement: IStateElement, path: string) => boolean;\n`,
   `export type SuppressPathDiagnosticHook = (stateElement: IStateElement, path: string) => boolean;\n` +
   `export type RowReusedHook = (stateElement: IStateElement, content: IContent) => void;\n`],
  [`  readonly suppressPathDiagnostic?: SuppressPathDiagnosticHook;\n}\n`,
   `  readonly suppressPathDiagnostic?: SuppressPathDiagnosticHook;\n  readonly rowReused?: RowReusedHook;\n}\n`],
  [`  "get", "indexShift", "handlerScope", "updated", "suppressPathDiagnostic",\n];\n`,
   `  "get", "indexShift", "handlerScope", "updated", "suppressPathDiagnostic", "rowReused",\n];\n`],
  [`    get: [], indexShift: [], handlerScope: [], updated: [], suppressPathDiagnostic: [],\n`,
   `    get: [], indexShift: [], handlerScope: [], updated: [], suppressPathDiagnostic: [], rowReused: [],\n`],
]);
await patch('src/apply/applyChangeToFor.ts', 'rowReused', [
  [`import { remountScopesUnderContent } from "../webComponent/mountScope";\n`, ``],
  [`        // connectedCallback が来ないので、マウントスコープを新しい行の listIndex へ張り直す（#4）\n` +
   `        remountScopesUnderContent(content, context.stateElement);\n`,
   `        // connectedCallback が来ないので、マウントスコープを新しい行の listIndex へ張り直す（#4）。\n` +
   `        // スコープ機能の rowReused hook（webComponent/addressHooks.ts）。hook の無い state は判定 1 個で抜ける\n` +
   `        const hooks = context.stateElement.addressHooks;\n` +
   `        if (hooks) {\n` +
   `          const reused = hooks.rowReused;\n` +
   `          for (let i = 0; i < reused.length; i++) {\n` +
   `            reused[i](context.stateElement, content);\n` +
   `          }\n` +
   `        }\n`],
]);
await patch('src/webComponent/addressHooks.ts', 'rowReused', [
  [` * 持つ state に付く hook（設計案 H1、S3）。従来 core（getByAddress / setByAddress / get トラップ /\n` +
   ` * event/handler / pathDiagnostics / updatedCallback）が直接 import していた分岐をここへ移し、\n`,
   ` * 持つ state に付く hook（設計案 H1、S3）。従来 core（getByAddress / setByAddress / get トラップ /\n` +
   ` * event/handler / pathDiagnostics / updatedCallback / applyChangeToFor）が直接 import していた分岐をここへ移し、\n`],
  [`import { createOverlayValue, readExportedAccessor, writeExportedAccessor } from "./overlay";\n`,
   `import { createOverlayValue, readExportedAccessor, writeExportedAccessor } from "./overlay";\nimport { remountScopesUnderContent } from "./mountScope";\n`],
  [`    return isPathUnderReservedVolume(rootNode, path);\n  },\n};\n`,
   `    return isPathUnderReservedVolume(rootNode, path);\n  },\n` +
   `  // その場で使い回した行は DOM から外れない ＝ 付け替えを知らせる connectedCallback が来ないので、\n` +
   `  // 行の中のマウントスコープを新しい行の listIndex へ張り直す（#4。マウントの無い state は中で抜ける）\n` +
   `  rowReused(stateElement, content) {\n` +
   `    remountScopesUnderContent(content, stateElement);\n` +
   `  },\n};\n`],
]);

// ---------------------------------------------------------------------------------------------
// 4. the readiness barrier `bind-component` was missing
await patch('src/components/State.ts', `the "bind-component" attribute`, [
  [`        prepared = await (runPreparing(this) ?? false);\n`,
   `        const preparing = runPreparing(this);\n` +
   `        if (preparing === null && this.hasAttribute("bind-component")) {\n` +
   `          // 引き取り手の居ない \`bind-component\` ＝ スコープ機能が未 install（readiness barrier、H5 / D13）。\n` +
   `          // 黙って素の state にしない。bind-component の他の設定エラーと同じく下の着地に載る\n` +
   `          requireLifecycleFeature("scopes", \`the "bind-component" attribute\`);\n` +
   `        }\n` +
   `        prepared = await (preparing ?? false);\n`],
]);
// ---------------------------------------------------------------------------------------------
// 5. test-side: three unit tests read bind-component's ledgers through apply without going through
//    `bootstrapState()`, so they put the receptacle in place themselves — what a split entry does
const PUT_HOOKS =
  `import { setComponentApplyHooks } from '../src/core/componentApplyHooks';\n` +
  `import { bindComponentApplyHooks } from '../src/webComponent/componentApply';\n` +
  `// bind-component の台帳は機能が受け口に置く（core/componentApplyHooks.ts）。bootstrapState() を経ないので自分で置く\n` +
  `setComponentApplyHooks(bindComponentApplyHooks);\n`;
await patch('__tests__/apply.applyChange.rootMount.test.ts', 'setComponentApplyHooks', [
  [`import type { IApplyContext } from '../src/apply/types';\n`, `import type { IApplyContext } from '../src/apply/types';\n` + PUT_HOOKS],
]);
await patch('__tests__/applyChange.coverage.test.ts', 'setComponentApplyHooks', [
  [`import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';\n`, `import { getRootNodeByFragment } from '../src/apply/rootNodeByFragment';\n` + PUT_HOOKS],
]);
await patch('__tests__/applyChangeToProperty.preCompletion.test.ts', 'setComponentApplyHooks', [
  [`import type { IApplyContext } from '../src/apply/types';\n`, `import type { IApplyContext } from '../src/apply/types';\n` + PUT_HOOKS],
]);

// 6. boundary tests: the bind-component barrier, the plain write without the receptacle, the
//    enqueue listener's idempotent registration
await patch('__tests__/core.lifecycleHooks.test.ts', 'the "bind-component" attribute', [
  [`describe("core/lifecycleHooks — order", () => {\n`,
   `describe("core/lifecycleHooks — readiness barrier（着地）", () => {\n` +
   `  it("scopes 未 install で bind-component を接続すると名指しで落ち、初期化失敗として着地すること", async () => {\n` +
   `    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);\n` +
   `    try {\n` +
   `      const stateEl = document.createElement(STATE_TAG) as State;\n` +
   `      stateEl.setAttribute("bind-component", "state");\n` +
   `      await expect((stateEl as any).connectedCallback())\n` +
   `        .rejects.toThrow(/\\[wcs\\/feature-not-installed\\] the "bind-component" attribute needs the "scopes" feature/);\n` +
   `      // 黙って素の state にならず、bind-component の他の設定エラーと同じ着地（#257）に載る\n` +
   `      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/feature-not-installed/);\n` +
   `      expect(errorSpy).toHaveBeenCalledTimes(1);\n` +
   `    } finally {\n` +
   `      errorSpy.mockRestore();\n` +
   `    }\n` +
   `  });\n` +
   `});\n\n` +
   `describe("core/lifecycleHooks — order", () => {\n`],
]);
await create('__tests__/core.componentApplyHooks.test.ts', `import { describe, it, expect, vi } from "vitest";

vi.mock("../src/apply/getValue", () => ({
  getValue: vi.fn(),
}));
vi.mock("../src/bindings/BindingSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bindings/BindingSession")>();
  return { ...actual, getBindingSession: vi.fn(() => null) };
});
vi.mock("../src/binding/getAbsoluteStateAddressByBinding", () => ({
  getAbsoluteStateAddressByBinding: vi.fn(() => ({ absolutePathInfo: {}, listIndex: null })),
  clearAbsoluteStateAddressByBinding: vi.fn(),
}));

import { applyChange } from "../src/apply/applyChange";
import { applyChangeToProperty } from "../src/apply/applyChangeToProperty";
import { getValue } from "../src/apply/getValue";
import { getPathInfo } from "../src/address/PathInfo";
import { componentApplyHooks } from "../src/core/componentApplyHooks";
import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "../src/webComponent/completeWebComponent";
import { getInjectedKeys, takeOverwrittenObject } from "../src/webComponent/preCompletionWrites";
import type { IBindingInfo } from "../src/types";
import type { IApplyContext } from "../src/apply/types";

/**
 * カスタム要素のプロパティ束縛の受け口（core/componentApplyHooks.ts）の境界。
 * このファイルは bind-component の機能を install しない（＝ 分割エントリで scopes を入れないページ）。
 */
const context = { stateName: "default", stateElement: {} as any, state: {} as any, appliedBindingSet: new Set() } as IApplyContext;

let counter = 0;
function createCustomElement(): any {
  const tag = \`cah-card-\${++counter}\`;
  customElements.define(tag, class extends HTMLElement {});
  return document.createElement(tag);
}

function binding(node: Element, propSegments: string[]): IBindingInfo {
  return {
    propName: propSegments.join("."),
    propSegments,
    propModifiers: [],
    statePathName: "user",
    statePathInfo: getPathInfo("user"),
    outFilters: [],
    inFilters: [],
    bindingType: "prop",
    uuid: null,
    node,
    replaceNode: node,
  } as IBindingInfo;
}

describe("core/componentApplyHooks — bind-component 未 install", () => {
  it("受け口は空であること", () => {
    expect(componentApplyHooks).toBeNull();
  });

  it("カスタム要素のオブジェクト値の置き換えも素の書き込みで、何も控えないこと", () => {
    const el = createCustomElement();
    el.state = { editing: false };
    const incoming = { name: "Alice" };
    applyChangeToProperty(binding(el, ["state"]), context, incoming);
    expect(el.state).toBe(incoming);
    expect(takeOverwrittenObject(el, "state")).toBeUndefined();
  });

  it("2 セグメントの書き込みも素の書き込みで、注入キーを控えないこと", () => {
    const el = createCustomElement();
    el.state = { message: "" };
    applyChangeToProperty(binding(el, ["state", "theme"]), context, { mode: "light" });
    applyChangeToProperty(binding(el, ["state", "message"]), context, "hello");
    expect(el.state).toEqual({ message: "hello", theme: { mode: "light" } });
    expect(getInjectedKeys(el, "state")).toBeUndefined();
  });

  it("applyChange は台帳を引かずに素のプロパティ書き込みへ倒れること（台帳に印があっても）", () => {
    const declared = createCustomElement();
    const completed = createCustomElement();
    document.body.append(declared, completed);
    markWebComponentStatePropDeclared(declared, "state");
    markWebComponentAsComplete(completed, "state");
    const applyContext = {
      rootNode: document,
      stateElement: { hasUpdatedCallback: false } as any,
      state: {} as any,
      appliedBindingSet: new Set(),
      newListValueByAbsAddress: new Map(),
      updatedAbsAddressSetByStateElement: new Map(),
      deferredSelectBindings: [],
    } as IApplyContext;
    vi.mocked(getValue).mockReturnValue({ name: "Alice" });
    try {
      applyChange(binding(declared, ["state"]), applyContext);
      applyChange(binding(completed, ["state"]), applyContext);
      expect(declared.state).toEqual({ name: "Alice" });
      expect(completed.state).toEqual({ name: "Alice" });
    } finally {
      declared.remove();
      completed.remove();
    }
  });
});
`);
// the scopes hook itself: attached to volume-only states too, so it keeps its own "has mounts" guard
await create('__tests__/webComponent.rowReused.test.ts', `import { describe, it, expect, vi } from "vitest";

vi.mock("../src/webComponent/mount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webComponent/mount")>();
  return { ...actual, getMountRecordsForStateElement: vi.fn(actual.getMountRecordsForStateElement) };
});

import { scopeAddressHooks } from "../src/webComponent/addressHooks";
import { getMountRecordsForStateElement } from "../src/webComponent/mount";
import type { IContent } from "../src/structural/types";

/**
 * スコープ機能の rowReused hook（apply/applyChangeToFor.ts の受け口）。スコープの hook はボリュームだけの
 * state（マウント無し）にも付くので、hook 自身が「マウントがあるか」で抜ける。
 */
describe("webComponent/addressHooks — rowReused", () => {
  it("マウントの無い state では張り直しの走査に入らないこと", () => {
    scopeAddressHooks.rowReused!({} as any, {} as IContent);
    expect(vi.mocked(getMountRecordsForStateElement)).not.toHaveBeenCalled();
  });
});
`);
await create('__tests__/updater.enqueueListener.test.ts', `import { describe, it, expect, vi } from "vitest";
import { getUpdater, registerEnqueueListener } from "../src/updater/updater";
import type { IAbsoluteStateAddress } from "../src/address/types";

/**
 * enqueue listener（updater の受け口。\`$watch\` の連鎖・\`on\` scan の保留 reset が install で登録する）の境界。
 * drain は走らせない（queueMicrotask を差し替える）ので、このファイルは他のテストと分けてある。
 */
describe("updater — enqueue listener", () => {
  it("書き込みの enqueue ごとに登録済み listener へアドレスを渡し、同じ listener の再登録は 1 回として扱うこと", () => {
    const listener = vi.fn();
    registerEnqueueListener(listener);
    registerEnqueueListener(listener);
    vi.stubGlobal("queueMicrotask", () => undefined);
    try {
      const address = {} as IAbsoluteStateAddress;
      getUpdater().enqueueAbsoluteAddress(address);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(address);
      // 描画だけのやり直しは書き込みではないので listener に届かない
      getUpdater().enqueueRenderOnlyAddress({} as IAbsoluteStateAddress);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
`);
console.log('done');
