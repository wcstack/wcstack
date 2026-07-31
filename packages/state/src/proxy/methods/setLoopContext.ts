/**
 * setLoopContext.ts
 *
 * StateClassの内部APIとして、ループコンテキスト（ILoopContext）を一時的に設定し、
 * 指定したコールバックをそのスコープ内で実行するための関数です。
 *
 * 主な役割:
 * - handler.loopContextにループコンテキストを一時的に設定
 * - 既にループコンテキストが設定されている場合はエラーを投げる
 * - 常にスコープを設定しコールバックを実行
 * - finallyで必ずloopContextをnullに戻し、スコープ外への影響を防止
 *
 * 設計ポイント:
 * - ループバインディングや多重ループ時のスコープ管理を安全に行う
 * - finallyで状態復元を保証し、例外発生時も安全
 *
 * **スコープは同期である（重要）**:
 * push/pop は `callback()` の同期リターンで完結する。callback が Promise を返した
 * 場合、finally はその Promise が settle する *前* に走るため、await を跨いだ先では
 * ループコンテキストは既に外れている。したがって async なハンドラが await の後に
 * `$1` や wildcard パス（`items.*.id`）を触ると raiseError になる。
 *
 * これは silent な取り違えではなく loud な失敗であり、意図した挙動である
 * （特性化テスト: `__tests__/poc.asyncOnLoopContext.test.ts`）。await の後に行位置が
 * 必要な場合は、ハンドラ引数で受け取った listIndexes を
 * `$resolve(path, indexes, value?)` に渡すこと。listIndexes は素の数値配列なので
 * await を跨いでも安全に持ち回せる。
 *
 * 補足: かつて `setLoopContextAsync` という変種が存在したが、実体は
 * `await _setLoopContext(...)`（= finally が既に走った後の Promise を await するだけ）
 * であり、名前が示唆する「コンテキストを await 跨ぎで保持する」挙動は持っていなかった。
 * production の呼び出し元も無かったため削除した。同等の機能が必要になった場合は、
 * 「名前どおりに動く」実装を新規に起こすこと。
 */

import { ILoopContext } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";

export function setLoopContext(
  handler: IStateHandler,
  loopContext: ILoopContext | null,
  callback: () => any
): any {
  if (typeof handler.loopContext !== "undefined") {
    raiseError('already in loop context');
  }
  handler.setLoopContext(loopContext);
  try {
    handler.pushAddress(loopContext);
    try {
      return callback();
    } finally {
      handler.popAddress();
    }
  } finally {
    handler.clearLoopContext();
  }
}
