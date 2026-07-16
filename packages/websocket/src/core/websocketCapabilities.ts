/**
 * websocketCapabilities.ts
 *
 * WebSocket node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。WebSocket は持続的な session / monitor node(1 本の接続を張り続ける)で、
 * 競合する operation を持たないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node の `_setError` は 4 形態の非 null 入力を受ける(いずれも公開 `error` shape は不変):
 *   1. synthetic な `{ message: "url is required." }`(`.name` 無し)— connect() の引数不備。
 *   2. synthetic な `{ message: "WebSocket is not connected." }`(`.name` 無し)— open 前の send()。
 *   3. caught された生の構築例外 `e`(`new WebSocket()` の同期 throw)。
 *   4. platform の WebSocket `error` Event(`Event`。`.name`/`.message` を持たない)。
 *
 * これらは shape がバラバラで、message からの分類は脆い。そこで呼び出し側が明示的な
 * taxonomy code を discriminator として渡す(storage の `deriveStorageErrorInfo(error, name)`
 * と同じ技法)。derive 側は synthetic / Event / Error を reverse-engineer せず、渡された
 * code で phase / recoverable を決め、message だけを防御的に抽出する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した websocket error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_WEBSOCKET_ERROR_CODE = {
  /** connect() の `url` 未指定 — 開始前の入力不備。retry では回復しない。 */
  InvalidArgument: "invalid-argument",
  /** open 前の send() — 接続が OPEN でない状態での送信。retry では回復しない(先に connect が要る)。 */
  InvalidState: "invalid-state",
  /**
   * 接続の確立 / 維持に失敗(`new WebSocket()` の同期例外、または platform の error Event)。
   * WebSocket のエラーは通常一過性で、再接続で回復しうる(recoverable=true)。
   */
  ConnectionError: "connection-error",
} as const;

/**
 * websocket の失敗を serializable な error taxonomy に写す。`code` は呼び出し側が渡す
 * discriminator(公開 `error` shape からは復元しない)。`message` は入力から防御的に抽出し、
 * message を持たない error Event 等では安定した fallback を使う。
 *
 * - `invalid-argument`(url 未指定)は開始前の入力不備 → phase="start" / recoverable=false。
 * - `invalid-state`(open 前 send)は接続状態が満たされない実行時失敗 → phase="execute" /
 *   recoverable=false(先に connect() が必要)。
 * - `connection-error`(構築例外 / error Event)は接続の確立 / 維持失敗 → phase="execute" /
 *   recoverable=true(再接続で回復しうる)。
 */
export function deriveWebSocketErrorInfo(error: unknown, code: string): WcsIoErrorInfo {
  // error は非 null(_setError は error===null を derive 前に分岐する)だが、synthetic /
  // Event / caught 例外 / 生 throw と shape がバラバラなので message は防御的に抽出する。
  // error Event は message を持たないため安定した fallback に落とす。
  const raw = (error as { message?: unknown }).message;
  const message = typeof raw === "string" ? raw : "WebSocket connection error";

  if (code === WCS_WEBSOCKET_ERROR_CODE.InvalidArgument) {
    return { code: WCS_WEBSOCKET_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  if (code === WCS_WEBSOCKET_ERROR_CODE.InvalidState) {
    return { code: WCS_WEBSOCKET_ERROR_CODE.InvalidState, phase: "execute", recoverable: false, message };
  }
  // connection-error(構築例外 / error Event): 接続の確立/維持失敗、再接続で回復しうる。
  return { code: WCS_WEBSOCKET_ERROR_CODE.ConnectionError, phase: "execute", recoverable: true, message };
}
