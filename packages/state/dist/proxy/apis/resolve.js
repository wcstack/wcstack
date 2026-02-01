/**
 * resolve.ts
 *
 * StateClassのAPIとして、パス（path）とインデックス（indexes）を指定して
 * Stateの値を取得・設定するための関数（resolve）の実装です。
 *
 * 主な役割:
 * - 文字列パス（path）とインデックス配列（indexes）から、該当するState値の取得・設定を行う
 * - ワイルドカードや多重ループを含むパスにも対応
 * - value未指定時は取得（getByRef）、指定時は設定（setByRef）を実行
 *
 * 設計ポイント:
 * - getStructuredPathInfoでパスを解析し、ワイルドカード階層ごとにリストインデックスを解決
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - getByRef/setByRefで値の取得・設定を一元的に処理
 * - 柔軟なバインディングやAPI経由での利用が可能
 */
import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { getByAddress } from "../methods/getByAddress";
import { setByAddress } from "../methods/setByAddress";
export function resolve(target, _prop, receiver, handler) {
    return (path, indexes, value) => {
        const pathInfo = getPathInfo(path);
        const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
            // gettersに含まれる場合は依存関係を登録
            if (stateElement.getterPaths.has(lastInfo.path)) {
                stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
            }
        }
        if (pathInfo.wildcardParentPathInfos.length > indexes.length) {
            raiseError(`indexes length is insufficient: ${path}`);
        }
        // ワイルドカード階層ごとにListIndexを解決していく
        let listIndex = null;
        for (let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
            const wildcardParentPathInfo = pathInfo.wildcardParentPathInfos[i];
            const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
            const tmpValue = getByAddress(target, wildcardAddress, receiver, handler);
            const listIndexes = getListIndexesByList(tmpValue);
            if (listIndexes == null) {
                raiseError(`ListIndexes not found: ${wildcardParentPathInfo.path}`);
            }
            const index = indexes[i];
            listIndex = listIndexes[index] ??
                raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
        }
        // ToDo:WritableかReadonlyかを判定して適切なメソッドを呼び出す
        const address = createStateAddress(pathInfo, listIndex);
        const hasSetValue = typeof value !== "undefined";
        if (!hasSetValue) {
            return getByAddress(target, address, receiver, handler);
        }
        else {
            setByAddress(target, address, value, receiver, handler);
        }
    };
}
//# sourceMappingURL=resolve.js.map