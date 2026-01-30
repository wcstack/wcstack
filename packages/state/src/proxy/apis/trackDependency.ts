/**
 * trackDependency.ts
 *
 * StateClassのAPIとして、getterチェーン中に参照されたパス間の
 * 依存関係を動的に登録するための関数（trackDependency）の実装です。
 *
 * 主な役割:
 * - 現在解決中のStatePropertyRef（lastRefStack）を取得
 * - pathManager.gettersに登録されているgetterの場合のみ依存を追跡
 * - 自身と同一パターンでない参照に対してaddDynamicDependencyを呼び出す
 *
 * 設計ポイント:
 * - lastRefStackが存在しない場合はSTATE-202エラーを発生させる
 * - getter同士の再帰（自己依存）は登録しない
 * - 動的依存はpathManagerに集約し、キャッシュの無効化に利用する
 */
import { raiseError } from "../../utils";
import { IStateHandler, IStateProxy } from "../_types";

/**
 * 現在解決中のgetterから、指定されたパスへの動的依存を登録する関数を返します。
 *
 * - pathManager.gettersに登録されているgetterのみ依存追跡を行う
 * - 自己参照は除外し、異なるパターン間の依存だけを記録
 * - 動的依存はpathManager.addDynamicDependencyで集中管理される
 *
 * @param target   プロキシ対象オブジェクト
 * @param prop     アクセスされたプロパティキー
 * @param receiver プロキシレシーバ
 * @param handler  StateClassハンドラ
 * @returns        引数pathで指定されたパターンへの依存を登録する無名関数
 */
export function trackDependency(
  target: Object, 
  prop: PropertyKey, 
  receiver: IStateProxy,
  handler: IStateHandler
): Function {
  return (path: string): void => {
    const lastInfo = handler.lastRefStack?.info ?? raiseError({
      code: 'STATE-202',
      message: 'Internal error: lastRefStack is null',
      context: { where: 'trackDependency', path },
      docsUrl: '/docs/error-codes.md#state',
    });
    if (handler.engine.pathManager.getters.has(lastInfo.pattern) &&
      lastInfo.pattern !== path) {
      handler.engine.pathManager.addDynamicDependency(lastInfo.pattern, path);
    }
  };
}
