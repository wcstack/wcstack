import { INDEX_BY_INDEX_NAME } from "../define";
import { wildcardScopeMessage } from "../pathDiagnostics";
import { raiseError } from "../raiseError";
import { ILoopContext } from "./types";
import { listIndexAtWildcard } from "./wildcardLevel";

// indexName ... $1, $2, ...
export function getIndexValueByLoopContext(loopContext: ILoopContext, indexName: string): number | null {
  if (loopContext.listIndex === null) {
    raiseError(`ListIndex not found for loopContext:`);
  }
  const indexPos = INDEX_BY_INDEX_NAME[indexName];
  if (typeof indexPos === "undefined") {
    raiseError(`Invalid index name: ${indexName}`);
  }
  const listIndex = listIndexAtWildcard(loopContext.listIndex, indexPos, loopContext.pathInfo.wildcardCount);
  if (listIndex === null) {
    // 位置が範囲外 ＝ `$2` を 1 段のループの中で読んだ、という取り違え。
    // 元の文面（`Index not found at position 1 for loopContext:`）は内部の言葉で、
    // 何段必要で何段あるのかが書かれていなかった。
    raiseError(wildcardScopeMessage(`"${indexName}"`, indexPos + 1, loopContext.pathInfo.wildcardCount));
  }
  return listIndex.index;
}