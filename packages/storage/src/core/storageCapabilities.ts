/**
 * storageCapabilities.ts
 *
 * Storage node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。storage の load / save / remove は同期で互いに競合しないため lane は
 * 持たず、error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";
import type { WcsStorageError } from "../types.js";

/** 安定した storage error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_STORAGE_ERROR_CODE = {
  /** `key` 未設定 / 不正な `type` などの入力不備。retry では回復しない。 */
  InvalidArgument: "invalid-argument",
  /** `QuotaExceededError` — 容量超過。空きを作れば回復しうる(環境要因)。 */
  QuotaExceeded: "quota-exceeded",
  /** `SecurityError` — storage アクセス拒否(cookie 無効 / third-party context 等)。retry では回復しない。 */
  NotAllowed: "not-allowed",
  /** その他の caught 例外。 */
  StorageError: "storage-error",
} as const;

/**
 * storage の失敗を serializable な error taxonomy に写す。
 *
 * `name` は caught 例外の `Error.name`(load / save / remove の catch から渡る)。
 * 未指定(undefined)は inline 構築の validation error(不正 `type` / `key` 未設定)を意味し、
 * これは開始前の入力不備なので phase="start" / `invalid-argument` / recoverable=false。
 * caught 例外は実行中の失敗なので phase="execute"。`QuotaExceededError` は環境要因で
 * 空きを作れば回復しうる(recoverable=true)、`SecurityError` は retry で回復しない。
 */
export function deriveStorageErrorInfo(error: WcsStorageError, name?: string): WcsIoErrorInfo {
  if (name === undefined) {
    return {
      code: WCS_STORAGE_ERROR_CODE.InvalidArgument,
      phase: "start",
      recoverable: false,
      message: error.message,
    };
  }
  if (name === "QuotaExceededError") {
    return { code: WCS_STORAGE_ERROR_CODE.QuotaExceeded, phase: "execute", recoverable: true, message: error.message };
  }
  if (name === "SecurityError") {
    return { code: WCS_STORAGE_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message: error.message };
  }
  return { code: WCS_STORAGE_ERROR_CODE.StorageError, phase: "execute", recoverable: true, message: error.message };
}
