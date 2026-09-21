/**
 * features/formats.ts — 書式フィルタ群（@wcstack/state/features/formats）。
 * `|uc` `|date(…)` `|round(…)` のような宣言が要求する実関数を core の登録簿へ置く。
 */
import type { IStateFeature } from "../core/features";
import { installFormats } from "../formats/install";

export const formats: IStateFeature = {
  name: "formats",
  install(): void {
    installFormats();
  },
};
export default formats;
