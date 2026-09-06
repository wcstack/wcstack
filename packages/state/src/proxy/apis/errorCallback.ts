/**
 * errorCallback.ts
 *
 * StateClass のライフサイクルフック「$errorCallback」を呼び出すユーティリティ関数。
 *
 * 主な役割:
 * - target に $errorCallback メソッドが定義されていれば、(error, info) で呼び出す
 * - this は writable な state proxy（receiver）— 作者はここで自分の state にエラーを書ける
 *
 * 設計ポイント:
 * - Reflect.get で安全に取得し、無ければ何もしない（disconnectedCallback と同型）
 * - 呼び出し元（apply/applyChangeFromBindings.ts）が drain 末尾でまとめて呼び、
 *   callback 自身の throw もそこで隔離する。ここでは await しない
 */

import { STATE_ERROR_CALLBACK_NAME } from "../../define";
import { IBindingErrorInfo } from "../../types";
import { IStateHandler } from "../types";

export function errorCallback(
  target: object,
  error: unknown,
  info: IBindingErrorInfo,
  receiver: any,
  _handler: IStateHandler
): void {
  const callback = Reflect.get(target, STATE_ERROR_CALLBACK_NAME);
  if (typeof callback === "function") {
    callback.call(receiver, error, info);
  }
}
