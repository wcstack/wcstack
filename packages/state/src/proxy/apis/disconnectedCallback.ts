/**
 * disconnectedCallback.ts
 *
 * StateClassのライフサイクルフック「$disconnectedCallback」を呼び出すユーティリティ関数です。
 *
 * 主な役割:
 * - オブジェクト（target）に$disconnectedCallbackメソッドが定義されていれば呼び出す
 * - コールバックはtargetのthisコンテキストで呼び出し、IReadonlyStateProxy（receiver）を引数として渡す
 *
 * 設計ポイント:
 * - Reflect.getで$disconnectedCallbackプロパティを安全に取得
 * - 存在しない場合は何もしない
 * - ライフサイクル管理やクリーンアップ処理に利用
 */

import { STATE_DISCONNECTED_CALLBACK_NAME } from "../../define";
import { IStateHandler } from "../types";

export function disconnectedCallback(
  target: object, 
  _prop: PropertyKey, 
  receiver: any,
  _handler: IStateHandler
): void {
  const callback = Reflect.get(target, STATE_DISCONNECTED_CALLBACK_NAME);
  if (typeof callback === "function") {
    callback.call(receiver);
  }
}
