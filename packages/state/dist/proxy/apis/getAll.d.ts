/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */
import { IStateHandler } from "../types";
export declare function getAll(target: Object, prop: PropertyKey, receiver: any, handler: IStateHandler): Function;
//# sourceMappingURL=getAll.d.ts.map