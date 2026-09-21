/**
 * scan/declarations.ts — `$scan` の宣言（設計案 H4、S4）。
 *
 * `$scan` は「世代を進める**前**に検証し、他の宣言が作った値を要る」唯一の宣言で、受け口の
 * 文脈袋（`IDeclarationContext`）を要求した当の機能。core が publish した `$eventTokens` の
 * 名前と再帰レジストリを検証で読み、解析したエントリを袋に入れて次の段へ渡す。
 *
 * 段の位置は docs/state-scan-design.md の順序契約そのまま:
 *   validate    `value` と宣言済みトークン名しか読まない（§1-2）
 *   applyEarly  出力の実体化は `_rebuildPathInfo` より前、`on` の購読は `$on` より前
 *               （同じトークンでは reducer → effect の順、D11）
 *   register    registry と from / resetOn の依存グラフ登録（`_pathSet` クリア後であること）。
 *               watch（order 10）より先に走る — scan だけを宣言した state も drain の発火対象に載せる
 */
import { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";
import { IRecursiveGetterLookup, materializeScanOutputs, parseScanDeclaration, registerScans, subscribeScanEvents, unregisterScans } from "./processScanDeclaration";
import type { IScanEntry } from "./types";
import { registerEnqueueListener } from "../updater/updater";
import { noteEnqueueForScanReset } from "./eventReset";

const SCAN_ENTRIES = "scanEntries";

export const scanDeclarationHooks: IDeclarationHooks = {
  // watch（10）・streams（20）より先。register の並び（scan → watch）もこれで決まる
  order: 8,
  validate(_element, value, ctx) {
    // `**` getter の展開形を from に書いた形を落とすため、`value` から作った再帰レジストリも渡す（D5）。
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
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installScanDeclarations(): void {
  if (installed) return;
  installed = true;
  registerDeclarationHooks("scan", scanDeclarationHooks);
  // `on` scan の `resetOn` を書き込みの時点で保留する（eventReset.ts）。該当する宣言が無ければ整数比較 1 回
  registerEnqueueListener(noteEnqueueForScanReset);
}
