/**
 * mediaCapabilities.ts
 *
 * camera / recorder node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。
 *
 * この 1 ファイルを CameraCore(getUserMedia)と RecorderCore(MediaRecorder)の両方が
 * import する。両 Core は同一の error detail 型(`WcsMediaErrorDetail = { name, message }`、
 * `.name` が DOMException 名 / "unsupported" sentinel / 各 Core 固有の合成名)を共有する
 * ため、derivation も 1 本で両者を賄える。lane は持たず(getUserMedia は acquire を
 * `_gen` で switchMap 済み、録画は command-driven)、error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsMediaErrorDetail } from "../types.js";
import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した media(camera / recorder)error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_MEDIA_ERROR_CODE = {
  /** getUserMedia / MediaRecorder API 不在(非セキュアコンテキスト含む) — "unsupported" sentinel。 */
  CapabilityMissing: "capability-missing",
  /** `NotAllowedError` / `SecurityError` — 権限拒否・feature-policy ブロック。 */
  NotAllowed: "not-allowed",
  /** `NotFoundError` — 要求した種類のデバイス(カメラ/マイク)が存在しない。 */
  NotFound: "not-found",
  /** `NotReadableError` — デバイスがハードウェア障害/他アプリ占有で読めない。 */
  NotReadable: "not-readable",
  /** `OverconstrainedError` / `NotSupportedError` — 制約・構成(mimeType 等)が満たせない。 */
  InvalidArgument: "invalid-argument",
  /** `NoStreamError` — stream 未 attach で録画開始(前提状態の不備)。 */
  InvalidState: "invalid-state",
  /** `AbortError` — 実行途中の中断(retry で回復しうる)。 */
  Aborted: "aborted",
  /** その他の実行時失敗(`RecorderError` / 想定外の MediaRecorder エラー等)。 */
  MediaError: "media-error",
} as const;

/**
 * 正規化済み media error(`WcsMediaErrorDetail = { name, message }`)を serializable な
 * error taxonomy に写す。`name` は DOMException 名 / "unsupported" sentinel / Core 固有の
 * 合成名(`NoStreamError` / `RecorderError`)。公開 `error` shape は不変で、これはその
 * 付加的な分類。
 *
 * - "unsupported" は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` / `SecurityError` は取得開始時の権限拒否 → phase="start" /
 *   not-allowed。retry で回復しない。
 * - `NotFoundError` は要求デバイス不在 → phase="start" / not-found。
 * - `NotReadableError` はデバイス占有/ハードウェア障害 → phase="start" / not-readable。
 * - `OverconstrainedError` / `NotSupportedError` は制約・構成が満たせない
 *   → phase="start" / invalid-argument。
 * - `NoStreamError`(stream 未 attach で録画開始)は前提状態の不備 → phase="start" /
 *   invalid-state。
 * - `AbortError` は実行途中の中断 → phase="execute" / aborted(recoverable=true)。
 * - それ以外(`RecorderError` / runtime MediaRecorder エラー / "Error" fallback 等)は
 *   phase="execute" / media-error。
 */
export function deriveMediaErrorInfo(error: WcsMediaErrorDetail): WcsIoErrorInfo {
  const { name, message } = error;
  if (name === "unsupported") {
    return { code: WCS_MEDIA_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { code: WCS_MEDIA_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
  }
  if (name === "NotFoundError") {
    return { code: WCS_MEDIA_ERROR_CODE.NotFound, phase: "start", recoverable: false, message };
  }
  if (name === "NotReadableError") {
    return { code: WCS_MEDIA_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message };
  }
  if (name === "OverconstrainedError" || name === "NotSupportedError") {
    return { code: WCS_MEDIA_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  if (name === "NoStreamError") {
    return { code: WCS_MEDIA_ERROR_CODE.InvalidState, phase: "start", recoverable: false, message };
  }
  if (name === "AbortError") {
    return { code: WCS_MEDIA_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
  }
  return { code: WCS_MEDIA_ERROR_CODE.MediaError, phase: "execute", recoverable: false, message };
}
