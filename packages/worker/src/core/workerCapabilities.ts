/**
 * workerCapabilities.ts
 *
 * Worker node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。worker は所有する子スレッドに対する command 駆動(start / post / terminate)
 * であり、競合する複数 operation を lane 管理する必要が無い(post は fire-and-forget、
 * start は張り替えを冪等ガード)ため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";
import type { WcsWorkerErrorDetail } from "../types.js";

/** 安定した worker error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_WORKER_ERROR_CODE = {
  /** `Worker` コンストラクタ不在(SSR / 非対応環境で構築が投げる)。 */
  CapabilityMissing: "capability-missing",
  /** `start(src)` の `src` 未指定(TypeError "src is required.")。 */
  InvalidArgument: "invalid-argument",
  /** worker スクリプトの uncaught error / messageerror / post 失敗 / 構築失敗など。 */
  WorkerError: "worker-error",
} as const;

/**
 * 正規化済み worker error(`WcsWorkerErrorDetail`)を serializable な error taxonomy に
 * 写す。`.name` で分岐する:
 *
 * - `TypeError` かつ `message === "src is required."` は `start()` 自身の引数検証。
 *   WorkerCore.start がこの固定 message で立てる唯一の検証 TypeError なので、runtime の
 *   worker error(name は "Error" / "DataError" 等)や構築失敗の TypeError とは message で
 *   一意に切り分かる → phase="start" / invalid-argument。
 * - それ以外の `TypeError` / `ReferenceError` は `new Worker(...)` の構築失敗。global
 *   `Worker` が `undefined` なら `new undefined()` が "... is not a constructor"(TypeError)、
 *   素の Node/SSR で `Worker` が未宣言なら "Worker is not defined"(ReferenceError)を投げる。
 *   いずれも platform API 欠如の顕れ → phase="probe" / capability-missing。runtime の worker
 *   error はこの 2 name を名乗らない(_onError は "Error"、_onMessageError は "DataError")ので
 *   誤爆しない。
 * - それ以外(worker スクリプトの `Error` / messageerror の `DataError` / post の
 *   `InvalidStateError` / `DataCloneError` / 構築時の `SecurityError` 等)は稼働中/構築時の
 *   失敗 → phase="execute" / worker-error。
 *
 * いずれも retry で自動回復しない(recoverable=false)。公開 `error` shape は不変。
 */
export function deriveWorkerErrorInfo(error: WcsWorkerErrorDetail): WcsIoErrorInfo {
  const { name, message } = error;
  if (name === "TypeError" && message === "src is required.") {
    return { code: WCS_WORKER_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  if (name === "TypeError" || name === "ReferenceError") {
    return { code: WCS_WORKER_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  return { code: WCS_WORKER_ERROR_CODE.WorkerError, phase: "execute", recoverable: false, message };
}
