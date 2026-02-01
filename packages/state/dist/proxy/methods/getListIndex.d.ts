/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedAddress）から
 * 対応するリストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - パスのワイルドカード種別（context/all/partial/none）に応じてリストインデックスを解決
 * - context型は現在のループコンテキストからリストインデックスを取得
 * - all型は各階層のリストインデックス集合からインデックスを辿って取得
 * - partial型やnone型は未実装またはnullを返す
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループ、ネストした配列バインディングに柔軟に対応
 * - getListIndexesByListで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで例外を投げる
 */
import { IResolvedAddress } from "../../address/types";
import { IListIndex } from "../../list/types";
import { IStateHandler } from "../types";
export declare function getListIndex(target: object, resolvedAddress: IResolvedAddress, receiver: any, handler: IStateHandler): IListIndex | null;
//# sourceMappingURL=getListIndex.d.ts.map