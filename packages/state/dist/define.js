export const DELIMITER = '.';
export const WILDCARD = '*';
export const MAX_WILDCARD_DEPTH = 128;
/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
const tmpIndexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
    tmpIndexByIndexName[`$${i + 1}`] = i;
}
export const INDEX_BY_INDEX_NAME = Object.freeze(tmpIndexByIndexName);
//# sourceMappingURL=define.js.map