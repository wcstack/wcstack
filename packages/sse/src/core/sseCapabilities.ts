/**
 * sseCapabilities.ts
 *
 * SSE node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。SSE は session/streaming の監視系(持続接続、競合する operation を持たない)
 * なので lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * `SseCore._setError(error, kind?)` は 3 形態の入力を受ける:
 *   1. synthetic な validation `Error`(`new Error("url is required.")`) — 入力不備。
 *   2. caught された EventSource 構築失敗(`new EventSource()` の throw、Error/DOMException)。
 *   3. EventSource が切断/再接続時に発火する生の `error` **Event**(message を持たない)。
 * 生の Event と Error を message coupling 無しに弁別し、さらに EventSource の
 * `error` Event が「恒久エラー(readyState CLOSED)」か「トランジェント再接続中
 * (readyState CONNECTING、ブラウザが自動再接続)」かは *raw な値では判別できない* ため、
 * 呼び出し側が明示的な `kind` discriminator を渡す(storage の
 * `deriveStorageErrorInfo(error, name)` / screen-orientation の
 * `deriveScreenOrientationErrorInfo(name, message)` と同じ discriminator 技法)。
 * derive 側は mixed shape を reverse-engineer しない。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した SSE error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_SSE_ERROR_CODE = {
  /** `url` 未指定などの入力不備。retry では回復しない。 */
  InvalidArgument: "invalid-argument",
  /**
   * EventSource の生成失敗、または稼働中ストリームの切断。EventSource は
   * CloseEvent を持たず error が切断も兼ねるため、生成失敗・恒久切断・トランジェント
   * 再接続を 1 つの code に畳み、`phase` / `recoverable` で区別する。
   */
  ConnectionError: "connection-error",
} as const;

/**
 * `SseCore._setError` の呼び出し側が渡す discriminator。raw な `Error`/`Event` だけでは
 * 判別できない「どの失敗経路か」を明示する。
 *
 * - `"invalid-argument"`   … connect() の引数不備(`url` 未指定)。stream 未開始。
 * - `"connection-start"`   … `new EventSource()` の構築失敗。stream 未確立。
 * - `"connection-transient"`… 稼働中 stream の切断だが readyState=CONNECTING で
 *                             ブラウザが自動再接続中(回復しうる)。
 * - `"connection-fatal"`   … 稼働中 stream の切断で readyState=CLOSED、ネイティブ
 *                             再接続は行われない(恒久エラー)。
 */
export type WcsSseErrorKind =
  | "invalid-argument"
  | "connection-start"
  | "connection-transient"
  | "connection-fatal";

/**
 * SSE の失敗を serializable な error taxonomy に写す。`kind` は呼び出し側が渡す
 * discriminator、`message` は公開 `error` に対応する文言(Event は message を持たない
 * ため "SSE connection error" 等の安定 fallback)。
 *
 * - `"invalid-argument"` は connect() 開始前の入力不備 → phase="start" /
 *   invalid-argument / recoverable=false。
 * - `"connection-start"` は EventSource 構築失敗で stream を確立できなかった失敗
 *   → phase="start" / connection-error / recoverable=false(生成された EventSource が
 *   無いためブラウザの自動再接続は起きない)。
 * - `"connection-transient"` は readyState=CONNECTING の切断でブラウザが自動再接続中
 *   → phase="execute" / connection-error / recoverable=true(呼び出し側の介入なしに
 *   回復しうる。SSE で recoverable=true になる唯一の経路)。
 * - `"connection-fatal"` は readyState=CLOSED の恒久切断 → phase="execute" /
 *   connection-error / recoverable=false(ネイティブ再接続は行われない)。
 */
export function deriveSseErrorInfo(kind: WcsSseErrorKind, message: string): WcsIoErrorInfo {
  if (kind === "invalid-argument") {
    return { code: WCS_SSE_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  if (kind === "connection-start") {
    return { code: WCS_SSE_ERROR_CODE.ConnectionError, phase: "start", recoverable: false, message };
  }
  if (kind === "connection-transient") {
    return { code: WCS_SSE_ERROR_CODE.ConnectionError, phase: "execute", recoverable: true, message };
  }
  // "connection-fatal": readyState=CLOSED の恒久切断。
  return { code: WCS_SSE_ERROR_CODE.ConnectionError, phase: "execute", recoverable: false, message };
}
