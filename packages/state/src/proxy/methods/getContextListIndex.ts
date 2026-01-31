/**
 * getContextListIndex.ts
 *
 * Stateの内部APIとして、現在のプロパティ参照スコープにおける
 * 指定したstructuredPath（ワイルドカード付きプロパティパス）に対応する
 * リストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - handlerの最後にアクセスされたAddressから、指定パスに対応するリストインデックスを取得
 * - ワイルドカード階層に対応し、多重ループやネストした配列バインディングにも利用可能
 *
 * 設計ポイント:
 * - 直近のプロパティ参照情報を取得
 * - info.indexByWildcardPathからstructuredPathのインデックスを特定
 * - listIndex.at(index)で該当階層のリストインデックスを取得
 * - パスが一致しない場合や参照が存在しない場合はnullを返す
 */

import { IListIndex } from "../../list/types";
import { IStateHandler } from "../types";

export function getContextListIndex(
  handler: IStateHandler,
  structuredPath: string
): IListIndex | null {
  const address = handler.lastAddressStack;
  if (address === null || typeof address === "undefined") {
    return null;
  }
  const index: number | undefined = address.pathInfo.indexByWildcardPath[structuredPath];
  if (typeof index === "undefined") {
    return null;
  }
  return address.listIndex?.at(index) ?? null;
}
