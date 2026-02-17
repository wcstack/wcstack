export const DELIMITER = '.';
export const WILDCARD = '*';
export const MAX_WILDCARD_DEPTH = 128;
export const MAX_LOOP_DEPTH = 128;
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
export const NO_SET_TIMEOUT = 60 * 1000; // 1分
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const STATE_CONNECTED_CALLBACK_NAME = "$connectedCallback";
export const STATE_DISCONNECTED_CALLBACK_NAME = "$disconnectedCallback";
export const STATE_UPDATED_CALLBACK_NAME = "$updatedCallback";
export const WEBCOMPONENT_STATE_READY_CALLBACK_NAME = "$stateReadyCallback";
//# sourceMappingURL=define.js.map