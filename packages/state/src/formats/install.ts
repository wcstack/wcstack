/**
 * formats/install.ts — 書式フィルタ群の install（設計案 §4、要件 D16）。
 *
 * `uc` / `date` / `round` / `truncate` … の実装を core の登録簿へ置く。core 自身が持つのは
 * エンジンが差し込む `not` だけなので、この機能を入れないページでは、宣言されたフィルタが
 * 束縛計画の段で `[wcs/filter-unknown]` として名指しで落ちる（黙って素通ししない）。
 */
import { registerFilters } from "../core/filterRegistry";
import { builtinFilterArity, inputBuiltinFilters, outputBuiltinFilters } from "./builtinFilters";

let installed = false;
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installFormats(): void {
  if (installed) return;
  installed = true;
  registerFilters("input", inputBuiltinFilters, builtinFilterArity);
  registerFilters("output", outputBuiltinFilters, builtinFilterArity);
}
