import { INDEX_BY_INDEX_NAME } from "../define";
import { raiseError } from "../raiseError";
// indexName ... $1, $2, ...
export function getIndexValueByLoopContext(loopContext, indexName) {
    if (loopContext.listIndex === null) {
        raiseError(`ListIndex not found for loopContext:`);
    }
    const indexPos = INDEX_BY_INDEX_NAME[indexName];
    if (typeof indexPos === "undefined") {
        raiseError(`Invalid index name: ${indexName}`);
    }
    const listIndex = loopContext.listIndex.at(indexPos);
    if (listIndex === null) {
        raiseError(`Index not found at position ${indexPos} for loopContext:`);
    }
    return listIndex.index;
}
//# sourceMappingURL=getIndexValueByLoopContext.js.map