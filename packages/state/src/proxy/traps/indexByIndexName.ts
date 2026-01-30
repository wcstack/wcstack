import { MAX_WILDCARD_DEPTH } from "../../define";

/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
export const indexByIndexName: { [key: PropertyKey]: number } = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
  indexByIndexName[`$${i+1}`] = i;
}
