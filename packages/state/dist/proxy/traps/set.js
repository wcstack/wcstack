/**
 * set.ts
 *
 * StateClassのProxyトラップとして、プロパティ設定時の値セット処理を担う関数（set）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、getResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - setByRefで構造化パス・リストインデックスに対応した値設定を実行
 * - それ以外（シンボル等）の場合はReflect.setで通常のプロパティ設定を実行
 *
 * 設計ポイント:
 * - バインディングや多重ループ、ワイルドカードを含むパスにも柔軟に対応
 * - setByRefを利用することで、依存解決や再描画などの副作用も一元管理
 * - Reflect.setで標準的なプロパティ設定の互換性も確保
 */
import { getResolvedAddress } from "../../address/ResolvedAddress";
import { getListIndex } from "../methods/getListIndex";
import { createStateAddress } from "../../address/StateAddress";
import { setByAddress } from "../methods/setByAddress";
export function set(target, prop, value, receiver, handler) {
    if (typeof prop === "string") {
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return setByAddress(target, stateAddress, value, receiver, handler);
    }
    else {
        return Reflect.set(target, prop, value, receiver);
    }
}
//# sourceMappingURL=set.js.map