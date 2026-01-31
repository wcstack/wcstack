/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedPathInfo）から
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
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで詳細な例外を投げる
 */
import { createStateAddress } from "../../address/StateAddress";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { getByAddress } from "./getByAddress";
import { getContextListIndex } from "./getContextListIndex";
export function getListIndex(target, resolvedAddress, receiver, handler) {
    const pathInfo = resolvedAddress.pathInfo;
    switch (resolvedAddress.wildcardType) {
        case "none":
            return null;
        case "context":
            const lastWildcardPath = pathInfo.wildcardPaths.at(-1) ??
                raiseError(`lastWildcardPath is null`);
            return getContextListIndex(handler, lastWildcardPath) ??
                raiseError(`ListIndex not found: ${resolvedAddress.pathInfo.path}`);
        case "all":
            let parentListIndex = null;
            for (let i = 0; i < resolvedAddress.pathInfo.wildcardCount; i++) {
                const wildcardParentPathInfo = resolvedAddress.pathInfo.wildcardParentPathInfos[i] ??
                    raiseError('wildcardParentPathInfo is null');
                const wildcardParentAddress = createStateAddress(wildcardParentPathInfo, parentListIndex);
                const wildcardParentValue = getByAddress(target, wildcardParentAddress, receiver, handler);
                const wildcardParentListIndexes = getListIndexesByList(wildcardParentValue) ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                const wildcardIndex = resolvedAddress.wildcardIndexes[i] ??
                    raiseError('wildcardIndex is null');
                parentListIndex = wildcardParentListIndexes[wildcardIndex] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
            }
            return parentListIndex;
        case "partial":
            raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
    }
}
//# sourceMappingURL=getListIndex.js.map