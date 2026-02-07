import { INDEX_BY_INDEX_NAME } from "../define";
import { raiseError } from "../raiseError";
import { ILoopContext } from "./types";

// indexName ... $1, $2, ...
export function getIndexValueByLoopContext(loopContext: ILoopContext, indexName: string): number | null {
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