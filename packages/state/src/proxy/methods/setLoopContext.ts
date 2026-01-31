/**
 * setLoopContext.ts
 *
 * StateClassの内部APIとして、ループコンテキスト（ILoopContext）を一時的に設定し、
 * 指定した非同期コールバックをそのスコープ内で実行するための関数です。
 *
 * 主な役割:
 * - handler.loopContextにループコンテキストを一時的に設定
 * - 既にループコンテキストが設定されている場合はエラーを投げる
 * - loopContextが存在する場合はasyncSetStatePropertyRefでスコープを設定しコールバックを実行
 * - loopContextがnullの場合はそのままコールバックを実行
 * - finallyで必ずloopContextをnullに戻し、スコープ外への影響を防止
 *
 * 設計ポイント:
 * - ループバインディングや多重ループ時のスコープ管理を安全に行う
 * - finallyで状態復元を保証し、例外発生時も安全
 * - 非同期処理にも対応
 */

import { createStateAddress } from "../../address/StateAddress";
import { ILoopContext } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";

export async function setLoopContext(
  handler: IStateHandler,
  loopContext: ILoopContext | null,
  callback: () => Promise<any>
): Promise<any> {
  if (typeof handler.loopContext !== "undefined") {
    raiseError('already in loop context');
  }
  handler.setLoopContext(loopContext);
  try {
    if (loopContext) {
      const stateAddress = createStateAddress(
        loopContext.elementPathInfo,
        loopContext.listIndex
      );
      handler.pushAddress(stateAddress);
      try {
        return await callback();
      } finally {
        handler.popAddress();
      }
    } else {
      return await callback();
    }
  } finally {
    handler.clearLoopContext();
  }
}
