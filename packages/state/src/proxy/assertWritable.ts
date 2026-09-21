import { raiseError } from "../raiseError";
import type { IStateHandler } from "./types";

/**
 * 書き込み API の入口が共通で呼ぶ、書き込み能力の検査（要件 B6）。
 *
 * set トラップ・`$resolve` の書き・`$setAll`（`**` のブロードキャストを含む）の 4 つの入口が、
 * 同じ規則・同じ文言で readonly のプロキシからの書き込みを拒否する。以前は set トラップだけが
 * 検査していて、`$resolve` / `$setAll` は readonly のプロキシからでも書けた。
 *
 * 共通の書き込み境界（`setByAddress`）には置かない: ランタイム自身（`$scan` の畳み込み・
 * `$watch` の連鎖など）が readonly のハンドラのまま内部の書き込みをしており、そこは利用者の
 * 書き込みではないため。
 */
export function assertWritable(handler: IStateHandler): void {
  if (handler.mutability === "readonly") {
    raiseError(`This state is readonly.`);
  }
}
