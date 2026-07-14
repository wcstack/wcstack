export const DELIMITER = '.';
export const WILDCARD = '*';
export const MAX_WILDCARD_DEPTH = 128;
export const MAX_LOOP_DEPTH = 128;
// 因果伝播（Phase 3）の 1 transaction あたり hop 上限。超過分の未処理 record は
// quarantine し（適用済みの値は戻さない）、updater から例外は投げない。
export const MAX_PROPAGATION_HOPS = 32;

// data-wcs バインディング構文 `[prop][#mod]: [path][@state][|filter...]` の区切り文字（単一正本）。
// これらは「死守の壁（構文契約）」であり値は不変。manifest.syntax.delimiters で公開される。
export const BINDING_SEPARATOR = ';';     // 複数バインディングの区切り
export const PROP_VALUE_SEPARATOR = ':';  // 左辺(prop)と右辺(path)の区切り
export const MODIFIER_SEPARATOR = '#';    // prop と修飾子の区切り
export const STATE_NAME_SEPARATOR = '@';  // path と @stateName の区切り
export const FILTER_SEPARATOR = '|';      // フィルタパイプの区切り

/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
const tmpIndexByIndexName: { [key: PropertyKey]: number } = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
  tmpIndexByIndexName[`$${i+1}`] = i;
}
export const INDEX_BY_INDEX_NAME: { [key: PropertyKey]: number } = Object.freeze(tmpIndexByIndexName);

export const NO_SET_TIMEOUT = 60 * 1000; // 1分

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const STATE_CONNECTED_CALLBACK_NAME = "$connectedCallback";
export const STATE_DISCONNECTED_CALLBACK_NAME = "$disconnectedCallback";
export const STATE_UPDATED_CALLBACK_NAME = "$updatedCallback";

export const WEBCOMPONENT_STATE_READY_CALLBACK_NAME = "$stateReadyCallback";

export const STATE_BINDABLES_NAME = "$bindables";
export const STATE_COMMAND_TOKENS_NAME = "$commandTokens";
export const STATE_COMMAND_NAMESPACE_NAME = "$command";
export const STATE_EVENT_TOKENS_NAME = "$eventTokens";
export const STATE_ON_NAME = "$on";
export const STATE_STREAMS_NAME = "$streams";
export const STATE_STREAM_STATUS_NAMESPACE_NAME = "$streamStatus";
export const STATE_STREAM_ERROR_NAMESPACE_NAME = "$streamError";
export const DCC_DEFINITION_ATTRIBUTE = "data-wc-definition";
