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

import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";

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

type TrackDependencyFunction = (path: string) => void;

export function trackDependency(
  _target: object, 
  _prop: PropertyKey, 
  _receiver: any,
  handler: IStateHandler
): TrackDependencyFunction {
  return (path: string): void => {
    if (handler.addressStackLength === 0) {
      raiseError(`No active state reference to track dependency for path "${path}".`);
    }
    const lastInfo = handler.lastAddressStack?.pathInfo ?? 
      raiseError('Internal error: lastAddressStack is null');
    const stateElement = handler.stateElement;
    if (handler.stateElement.getterPaths.has(lastInfo.path) &&
      lastInfo.path !== path) {
      stateElement.addDynamicDependency(path, lastInfo.path);
    }
  };
}
