/**
 * untrackDependency.ts
 *
 * StateClass の API として、コールバック実行中の依存追跡を抑止する関数
 * （$untrackDependency）の実装です。$trackDependency（明示的な依存登録）と
 * 対称の「明示的な依存抑止」API。
 *
 * 主な役割:
 * - fn 実行中、checkDependency の動的依存登録と $1 インデックス依存の記録を抑止
 * - fn の戻り値をそのまま返す（値の読み取り自体は通常どおり行われる）
 *
 * 設計ポイント:
 * - スコープはハンドラ単位のカウンタ（ネスト可）で管理し、finally で必ず復元する
 * - 典型例: リスト行 getter が「行の外の単一値」を読みたいが、その値の変更で
 *   全行を再評価させたくない場合（選択インデックス等）。書き手側が該当行へ
 *   直接書き込むことで、必要な行だけが更新される
 */

import { IStateHandler } from "../types";

type UntrackDependencyFunction = <T>(fn: () => T) => T;

export function untrackDependency(
  _target: object,
  _prop: PropertyKey,
  _receiver: any,
  handler: IStateHandler
): UntrackDependencyFunction {
  return <T>(fn: () => T): T => {
    handler.beginUntrack();
    try {
      return fn();
    } finally {
      handler.endUntrack();
    }
  };
}
