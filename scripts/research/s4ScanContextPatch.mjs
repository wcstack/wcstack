// S4, third slice (wiring design §8-4's open question): `$scan` through the declaration receptacle.
// `$scan` is the case the previous slice left in the core: its validation runs BEFORE the generation
// bump and needs two values other declarations produce — `$eventTokens`'s names and the recursion
// registry. That is what the per-set CONTEXT BAG is for: the core creates one, publishes what it
// computed into it, and features read from and write to it across phases (scan's parsed entries
// travel validate → applyEarly → register in it).
// Two phases join the receptacle: `validate` (before the generation bump, reads only `value`) and
// `applyEarly` (right after the `__state` swap, before `$on` is wired — `$scan`'s outputs must be
// materialized before `_rebuildPathInfo` and its subscriptions before `$on`, D11).
// Applied to a sandbox copy of packages/state carrying S3's three slices and S4's first two;
// every anchor must match exactly once.
//   node scripts/research/s4ScanContextPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4ScanContextPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3 && typeof edit[2] === 'string') {
      const [start, end, replacement] = edit;
      const s = code.indexOf(start);
      if (s === -1 || code.indexOf(start, s + 1) !== -1) throw new Error(`${rel}: start anchor not unique: ${start.slice(0, 70)}`);
      const e = code.indexOf(end, s);
      if (e === -1 || code.indexOf(end, e + 1) !== -1) throw new Error(`${rel}: end anchor not unique: ${end.slice(0, 70)}`);
      code = code.slice(0, s) + replacement + code.slice(e + end.length);
      continue;
    }
    const [anchor, replacement] = edit;
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
async function writeOnce(rel, content) {
  const file = join(pkg, rel);
  const existing = await readFile(file, 'utf8').catch(() => null);
  if (existing !== null && existing.replaceAll('\r\n', '\n').includes(content.slice(0, 200))) { console.log('already written', rel); return; }
  await writeFile(file, content);
  console.log('wrote', rel);
}

// 1. the receptacle grows the two early phases and the context bag
await patch('src/core/declarationHooks.ts', 'IDeclarationContext', [
  [` *   apply       新しい getterPaths / setterPaths の収集後（\`$streams\` の衝突検査がそれを見る）\n`,
   ` *   validate    世代を進める前（\`value\` しか読まない検証。ここで throw した再セットは世代を進めない）\n` +
   ` *   applyEarly  \`__state\` の差し替え直後・\`$on\` の配線より前（\`$scan\` の出力の実体化と購読）\n` +
   ` *   apply       新しい getterPaths / setterPaths の収集後（\`$streams\` の衝突検査がそれを見る）\n`],
  [` * これが「watch は stream より先に起動し、後に停止する」を番号だけで保つ\n * （従来 \`State\` に直書きされていた順序契約）。\n */\n`,
   ` * これが「watch は stream より先に起動し、後に停止する」を番号だけで保つ\n * （従来 \`State\` に直書きされていた順序契約）。\n` +
   ` *\n` +
   ` * **文脈袋**（\`IDeclarationContext\`）: 段を跨いで機能どうしが値を渡す口。core は自分が作った値\n` +
   ` * （\`$eventTokens\` の名前・再帰レジストリ）を publish し、\`$scan\` の検証がそれを読む。解析した\n` +
   ` * エントリも袋に入れて validate → applyEarly → register を渡り歩く。1 回の set につき 1 つ作る。\n */\n`],
  [`export interface IDeclarationHooks {\n`,
   `/** 1 回の \`_state\` set の間だけ生きる、機能どうしの受け渡し口 */\nexport interface IDeclarationContext {\n  get<T>(key: string): T | undefined;\n  set(key: string, value: unknown): void;\n}\n\nexport function createDeclarationContext(): IDeclarationContext {\n  const values = new Map<string, unknown>();\n  return {\n    get<T>(key: string): T | undefined {\n      return values.get(key) as T | undefined;\n    },\n    set(key: string, value: unknown): void {\n      values.set(key, value);\n    },\n  };\n}\n\nexport interface IDeclarationHooks {\n`],
  [`  readonly apply?: (element: IStateElement, value: IState) => void;\n  readonly register?: (element: IStateElement, value: IState) => void;\n`,
   `  readonly validate?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n  readonly applyEarly?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n  readonly apply?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n  readonly register?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n`],
  [`export function runApply(element: IStateElement, value: IState): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].apply?.(element, value);\n  }\n}\n\nexport function runRegister(element: IStateElement, value: IState): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].register?.(element, value);\n  }\n}\n`,
   `export function runValidate(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].validate?.(element, value, ctx);\n  }\n}\n\nexport function runApplyEarly(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].applyEarly?.(element, value, ctx);\n  }\n}\n\nexport function runApply(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].apply?.(element, value, ctx);\n  }\n}\n\nexport function runRegister(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].register?.(element, value, ctx);\n  }\n}\n`],
]);

// 2. the scan feature owns its declaration
await writeOnce('src/scan/declarations.ts', `/**
 * scan/declarations.ts — \`$scan\` の宣言（設計案 H4、S4）。
 *
 * \`$scan\` は「世代を進める**前**に検証し、他の宣言が作った値を要る」唯一の宣言で、受け口の
 * 文脈袋（\`IDeclarationContext\`）を要求した当の機能。core が publish した \`$eventTokens\` の
 * 名前と再帰レジストリを検証で読み、解析したエントリを袋に入れて次の段へ渡す。
 *
 * 段の位置は docs/state-scan-design.md の順序契約そのまま:
 *   validate    \`value\` と宣言済みトークン名しか読まない（§1-2）
 *   applyEarly  出力の実体化は \`_rebuildPathInfo\` より前、\`on\` の購読は \`$on\` より前
 *               （同じトークンでは reducer → effect の順、D11）
 *   register    registry と from / resetOn の依存グラフ登録（\`_pathSet\` クリア後であること）。
 *               watch（order 10）より先に走る — scan だけを宣言した state も drain の発火対象に載せる
 */
import type { IStateElement } from "../components/types";
import type { IState } from "../types";
import { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";
import { IRecursiveGetterLookup, materializeScanOutputs, parseScanDeclaration, registerScans, subscribeScanEvents, unregisterScans } from "./processScanDeclaration";
import type { IScanEntry } from "./types";

const SCAN_ENTRIES = "scanEntries";

export const scanDeclarationHooks: IDeclarationHooks = {
  // watch（10）・streams（20）より先。register の並び（scan → watch）もこれで決まる
  order: 8,
  validate(_element, value, ctx) {
    // \`**\` getter の展開形を from に書いた形を落とすため、\`value\` から作った再帰レジストリも渡す（D5）。
    // fold が関数を返す出力は、その出力に置いた関数値をメソッド衝突と見なさない（scan/initialValue.ts の記録・D7）。
    const entries = parseScanDeclaration(
      value,
      ctx.get<ReadonlySet<string>>("eventTokenNames") ?? new Set<string>(),
      ctx.get<IRecursiveGetterLookup | null>("recursionRegistry") ?? null,
    );
    ctx.set(SCAN_ENTRIES, entries);
  },
  applyEarly(element, value, ctx) {
    const entries = ctx.get<readonly IScanEntry[] | null>(SCAN_ENTRIES) ?? null;
    if (entries !== null) {
      materializeScanOutputs(value, entries);
      subscribeScanEvents(element, entries);
    }
  },
  register(element, _value, ctx) {
    const entries = ctx.get<readonly IScanEntry[] | null>(SCAN_ENTRIES) ?? null;
    const carried = unregisterScans(element);
    element.setScanPaths?.(entries === null ? null : registerScans(element, entries, carried));
  },
};

let installed = false;
/** 冪等。full / auto では \`bootstrapState()\` が呼ぶ */
export function installScanDeclarations(): void {
  if (installed) return;
  installed = true;
  registerDeclarationHooks("scan", scanDeclarationHooks);
}
`);

// 3. the full entry installs it with the others
await patch('src/bootstrapState.ts', 'installScanDeclarations', [
  [`import { installWatchRuntime } from "./watch/watchRuntime";\n`,
   `import { installWatchRuntime } from "./watch/watchRuntime";\nimport { installScanDeclarations } from "./scan/declarations";\n`],
  [`  installWatchRuntime();\n`, `  installWatchRuntime();\n  installScanDeclarations();\n`],
]);

// 4. the element's internal surface
await patch('src/components/types.ts', 'setScanPaths', [
  [`  setWatchPaths?(paths: ReadonlySet<string> | null): void;\n`,
   `  setWatchPaths?(paths: ReadonlySet<string> | null): void;\n  /** \`$scan\` の \`from\` パス（\`watchPaths\` と並ぶ旧値キャプチャのゲート） */\n  setScanPaths?(paths: ReadonlySet<string> | null): void;\n`],
]);

// 5. State: `$scan` leaves, and the context bag threads the phases
await patch('src/components/State.ts', 'createDeclarationContext', [
  [`import { materializeScanOutputs, parseScanDeclaration, registerScans, subscribeScanEvents, unregisterScans } from "../scan/processScanDeclaration";\n`, ``],
  [`import { runActivate, runApply, runDeactivate, runRegister } from "../core/declarationHooks";\n`,
   `import { createDeclarationContext, runActivate, runApply, runApplyEarly, runDeactivate, runRegister, runValidate } from "../core/declarationHooks";\n`],
  // validate: the bag is created here and carries what the core computed
  [`    // $scan の検証も \`value\` と宣言済みトークン名しか読まない（docs/state-scan-design.md §1-2）。\n`,
   `    const scanEntries = parseScanDeclaration(value, eventTokenNames, recursionRegistry);\n`,
   `    // 宣言の検証（設計案 H4 の validate）: 世代を進める前の、\`value\` しか読まない段。ここで throw した\n` +
   `    // 再セットは世代を進めない。機能どうしが段を跨いで値を渡す文脈袋をこの set のぶんだけ作り、\n` +
   `    // core が作った値（\`$eventTokens\` の名前・再帰レジストリ）を publish する — \`$scan\` の検証が読む\n` +
   `    const declarations = createDeclarationContext();\n` +
   `    declarations.set("eventTokenNames", eventTokenNames);\n` +
   `    declarations.set("recursionRegistry", recursionRegistry);\n` +
   `    runValidate(this, value, declarations);\n`],
  // applyEarly: before `$on` is wired
  [`    // $scan（docs/state-scan-design.md §2-4）: 出力の実体化は \`_rebuildPathInfo\` より前、\n`,
   `    if (scanEntries !== null) {\n      materializeScanOutputs(value, scanEntries);\n      subscribeScanEvents(this, scanEntries);\n    }\n`,
   `    // 差し替え直後の段（設計案 H4 の applyEarly）: \`$on\` の配線より前に走る（\`$scan\` の出力の実体化と\n` +
   `    // 購読 — 同じトークンでは reducer → effect の順、D11。scan/declarations.ts）\n` +
   `    runApplyEarly(this, value, declarations);\n`],
  // register: scan's registration is the feature's now, and runs before watch's (order 8 < 10)
  [`    // $scan: registry と from / resetOn の依存グラフ登録（_pathSet クリア後であること）。\n`,
   `    this._scanPaths = scanEntries === null ? null : registerScans(this, scanEntries, carriedScanResets);\n`,
   ``],
  [`    runApply(this, value);\n`, `    runApply(this, value, declarations);\n`],
  [`    runRegister(this, value);\n`, `    runRegister(this, value, declarations);\n`],
  // the internal surface
  [`  setWatchPaths(paths: ReadonlySet<string> | null): void {\n    this._watchPaths = paths;\n  }\n`,
   `  setWatchPaths(paths: ReadonlySet<string> | null): void {\n    this._watchPaths = paths;\n  }\n\n  setScanPaths(paths: ReadonlySet<string> | null): void {\n    this._scanPaths = paths;\n  }\n`],
]);
console.log('done');
