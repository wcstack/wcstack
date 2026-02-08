import { calcWildcardLen } from "../address/calcWildcardLen";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { config } from "../config";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { raiseError } from "../raiseError";
const MAX_DEPENDENCY_DEPTH = 1000;
// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress = new WeakMap();
function getIndexes(listDiff, searchType) {
    switch (searchType) {
        case "old":
            return listDiff.oldIndexes;
        case "new":
            return listDiff.newIndexes;
        case "add":
            return listDiff.addIndexSet;
        case "change":
            return listDiff.changeIndexSet;
        case "delete":
            return listDiff.deleteIndexSet;
        default:
            if (config.debug) {
                console.log(`Invalid search type: ${searchType}`);
            }
            return [];
    }
}
function _walkExpandWildcard(context, currentWildcardIndex, parentListIndex) {
    const parentPath = context.wildcardParentPaths[currentWildcardIndex];
    const parentPathInfo = getPathInfo(parentPath);
    const parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    const lastValue = lastValueByListAddress.get(parentAddress);
    const newValue = context.stateProxy.$$getByAddress(parentAddress);
    const listDiff = createListDiff(parentAddress.listIndex, lastValue, newValue);
    const loopIndexes = getIndexes(listDiff, context.searchType);
    if (currentWildcardIndex === context.wildcardPaths.length - 1) {
        context.targetListIndexes.push(...loopIndexes);
    }
    else {
        for (const listIndex of loopIndexes) {
            _walkExpandWildcard(context, currentWildcardIndex + 1, listIndex);
        }
    }
    context.newValueByAddress.set(parentAddress, newValue);
}
function _walkDependency(context, startAddress, callback) {
    const stack = [{ address: startAddress, depth: 0 }];
    while (stack.length > 0) {
        const { address, depth } = stack.pop();
        if (depth > MAX_DEPENDENCY_DEPTH) {
            raiseError(`Maximum dependency depth of ${MAX_DEPENDENCY_DEPTH} exceeded. Possible circular dependency detected at path: ${address.pathInfo.path}`);
        }
        if (context.visited.has(address)) {
            continue;
        }
        context.visited.add(address);
        callback(address);
        const sourcePath = address.pathInfo.path;
        const nextDepth = depth + 1;
        // 依存アドレスを逆順でpushするための一時バッファ
        const nextEntries = [];
        /**
         * パスから依存関係をたどる
         * users.*.name <= users.* <= users
         * ただし、users がリストであれば users.* の依存関係は展開する
         */
        const staticDeps = context.staticMap.get(sourcePath);
        if (staticDeps) {
            for (const dep of staticDeps) {
                const depPathInfo = getPathInfo(dep);
                if (context.listPathSet.has(sourcePath) && depPathInfo.lastSegment === WILDCARD) {
                    //expand indexes
                    const newValue = context.stateProxy.$$getByAddress(address);
                    const lastValue = lastValueByListAddress.get(address);
                    const listDiff = createListDiff(address.listIndex, lastValue, newValue);
                    for (const listIndex of listDiff.newIndexes) {
                        const depAddress = createStateAddress(depPathInfo, listIndex);
                        context.result.add(depAddress);
                        nextEntries.push({ address: depAddress, depth: nextDepth });
                    }
                    context.newValueByAddress.set(address, newValue);
                }
                else {
                    const depAddress = createStateAddress(depPathInfo, address.listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        /**
         * 動的依存関係をたどる
         * 動的依存関係は、getterの実行時に決定される
         *
         * source,           target
         *
         * products.*.price => products.*.tax
         * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
         *
         * products.*.price => products.summary
         * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
         *
         * categories.*.name => categories.*.products.*.categoryName
         * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
         */
        const dynamicDeps = context.dynamicMap.get(sourcePath);
        if (dynamicDeps) {
            for (const dep of dynamicDeps) {
                const depPathInfo = getPathInfo(dep);
                const listIndexes = [];
                if (depPathInfo.wildcardCount > 0) {
                    // ワイルドカードを含む依存関係の処理
                    // 同じ親を持つかをパスの集合積で判定する
                    // polyfills.tsにてSetのintersectionメソッドを定義している
                    const wildcardLen = calcWildcardLen(address.pathInfo, depPathInfo);
                    const expandable = (depPathInfo.wildcardCount - wildcardLen) >= 1;
                    if (expandable) {
                        let listIndex;
                        if (wildcardLen > 0) {
                            // categories.*.name => categories.*.products.*.categoryName
                            // ワイルドカードを含む同じ親（products.*）を持つのが、
                            // さらに下位にワイルドカードがあるので展開する
                            if (address.listIndex === null) {
                                raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                            }
                            listIndex = address.listIndex.at(wildcardLen - 1);
                        }
                        else {
                            // selectedIndex => items.*.selected
                            // 同じ親を持たない場合はnullから開始
                            listIndex = null;
                        }
                        const expandContext = {
                            targetPathInfo: depPathInfo,
                            targetListIndexes: [],
                            wildcardPaths: depPathInfo.wildcardPaths,
                            wildcardParentPaths: depPathInfo.wildcardParentPaths,
                            stateProxy: context.stateProxy,
                            searchType: context.searchType,
                            newValueByAddress: context.newValueByAddress,
                        };
                        _walkExpandWildcard(expandContext, wildcardLen, listIndex);
                        listIndexes.push(...expandContext.targetListIndexes);
                    }
                    else {
                        // products.*.price => products.*.tax
                        // ワイルドカードを含む同じ親（products.*）を持つので、リストインデックスは引き継ぐ
                        if (address.listIndex === null) {
                            raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                        }
                        const listIndex = address.listIndex.at(wildcardLen - 1);
                        listIndexes.push(listIndex);
                    }
                }
                else {
                    // products.*.tax => currentTaxRate
                    // 同じ親を持たないので、リストインデックスはnull
                    listIndexes.push(null);
                }
                for (const listIndex of listIndexes) {
                    const depAddress = createStateAddress(depPathInfo, listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        // 逆順でpushして、元の再帰と同じ探索順序を保つ
        for (let i = nextEntries.length - 1; i >= 0; i--) {
            stack.push(nextEntries[i]);
        }
    }
}
export function walkDependency(startAddress, staticDependency, dynamicDependency, listPathSet, stateProxy, searchType, callback) {
    const context = {
        staticMap: staticDependency,
        dynamicMap: dynamicDependency,
        result: new Set(),
        listPathSet: listPathSet,
        visited: new Set(),
        stateProxy: stateProxy,
        searchType: searchType,
        newValueByAddress: new Map(),
    };
    try {
        _walkDependency(context, startAddress, callback);
        return Array.from(context.result);
    }
    finally {
        for (const [address, newValue] of context.newValueByAddress.entries()) {
            lastValueByListAddress.set(address, newValue);
        }
    }
}
//# sourceMappingURL=walkDependency.js.map