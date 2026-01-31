/**
 * getByRef.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByRef）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（trackedGetters対応時はsetTrackingでラップ）
 * - キャッシュ機構（handler.cacheable時はrefKeyで値をキャッシュ）
 * - getter経由で値取得時はSetStatePropertyRefSymbolでスコープを一時設定
 * - 存在しない場合は親infoやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - handler.engine.trackedGettersに含まれる場合はsetTrackingで依存追跡を有効化
 * - キャッシュ有効時はrefKeyで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */
import { createListIndexes } from "../../list/createListIndexes";
import { getListIndexesByList, setListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { checkDependency } from "./checkDependency";
function _getByAddress(target, address, receiver, handler, stateElement) {
    let value;
    // 親子関係のあるgetterが存在する場合は、外部依存から取得
    /*
      if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.getters.intersection(ref.info.cumulativePathSet).size === 0) {
        return handler.engine.stateOutput.get(ref);
      }
    */
    // パターンがtargetに存在する場合はgetter経由で取得
    if (address.pathInfo.path in target) {
        if (stateElement.getterPaths.has(address.pathInfo.path)) {
            handler.pushAddress(address);
            try {
                return value = Reflect.get(target, address.pathInfo.path, receiver);
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            return value = Reflect.get(target, address.pathInfo.path);
        }
    }
    else {
        const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
        const parentValue = getByAddress(target, parentAddress, receiver, handler);
        const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
        if (lastSegment === "*") {
            const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined`);
            return value = Reflect.get(parentValue, index);
        }
        else {
            return value = Reflect.get(parentValue, lastSegment);
        }
    }
}
function _getByAddressWithCache(target, address, receiver, handler, stateElement, listable) {
    let value;
    let lastCacheEntry = stateElement.cache.get(address) ?? null;
    // Updateで変更が必要な可能性があるパスのバージョン情報
    const mightChangeByPath = handler.stateElement.mightChangeByPath;
    const versionRevision = mightChangeByPath.get(address.pathInfo.path);
    if (lastCacheEntry !== null) {
        const lastVersionInfo = lastCacheEntry.versionInfo;
        if (typeof versionRevision === "undefined") {
            // 更新なし
            return lastCacheEntry.value;
        }
        else {
            if (lastVersionInfo.version > handler.updater.versionInfo.version) {
                // これは非同期更新が発生した場合にありえる
                return lastCacheEntry.value;
            }
            if (lastVersionInfo.version < versionRevision.version || lastVersionInfo.revision < versionRevision.revision) {
                // 更新あり
            }
            else {
                return lastCacheEntry.value;
            }
        }
    }
    try {
        return value = _getByAddress(target, address, receiver, handler, stateElement);
    }
    finally {
        let newListIndexes = null;
        if (listable) {
            // リストインデックスを計算する必要がある
            const oldListIndexes = getListIndexesByList(lastCacheEntry?.value) ?? [];
            newListIndexes = createListIndexes(address.listIndex, lastCacheEntry?.value, value, oldListIndexes);
            setListIndexesByList(value, newListIndexes);
        }
        const cacheEntry = Object.assign(lastCacheEntry ?? {}, {
            value: value,
            versionInfo: { ...handler.updater.versionInfo },
        });
        stateElement.cache.set(address, cacheEntry);
    }
}
/**
 * 構造化パス情報(info, listIndex)をもとに、状態オブジェクト(target)から値を取得する。
 *
 * - 依存関係の自動登録（trackedGetters対応時はsetTrackingでラップ）
 * - キャッシュ機構（handler.cacheable時はrefKeyでキャッシュ）
 * - ネスト・ワイルドカード対応（親infoやlistIndexを辿って再帰的に値を取得）
 * - getter経由で値取得時はSetStatePropertyRefSymbolでスコープを一時設定
 *
 * @param target    状態オブジェクト
 * @param info      構造化パス情報
 * @param listIndex リストインデックス（多重ループ対応）
 * @param receiver  プロキシ
 * @param handler   状態ハンドラ
 * @returns         対象プロパティの値
 */
export function getByAddress(target, address, receiver, handler) {
    checkDependency(handler, address);
    const stateElement = handler.stateElement;
    const listable = stateElement.listPaths.has(address.pathInfo.path);
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    let value;
    if (cacheable || listable) {
        return value = _getByAddressWithCache(target, address, receiver, handler, stateElement, listable);
    }
    else {
        return value = _getByAddress(target, address, receiver, handler, stateElement);
    }
}
//# sourceMappingURL=getByAddress.js.map