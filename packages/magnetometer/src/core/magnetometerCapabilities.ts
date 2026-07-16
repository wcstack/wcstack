/**
 * magnetometerCapabilities.ts
 *
 * Magnetometer node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。sensor は監視系(継続 subscribe/unsubscribe)で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * sensor family(accelerometer / gyroscope / magnetometer / ambient-light-sensor)は
 * error 面が構造同一(`{ error: <name>, message }`、`.error` が Error.name / "unsupported"
 * / "error" fallback)なので、taxonomy も 4 兄弟で一致させる。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した magnetometer error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_MAGNETOMETER_ERROR_CODE = {
  /** Sensor API 非対応(`globalThis.Magnetometer` 不在)。 */
  CapabilityMissing: "capability-missing",
  /** `SecurityError` / `NotAllowedError` — 権限拒否・feature-policy ブロック。 */
  NotAllowed: "not-allowed",
  /** `NotReadableError` — センサーハードウェアを読めない。 */
  NotReadable: "not-readable",
  /** その他の SensorErrorEvent / 想定外の失敗。 */
  SensorError: "sensor-error",
} as const;

/**
 * sensor の失敗を serializable な error taxonomy に写す。`name` は error detail の
 * `.error`(`Error.name` / "unsupported" / "error" fallback)。
 *
 * - "unsupported" は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `SecurityError` / `NotAllowedError` は sensor 構築時の権限拒否 → phase="start" /
 *   not-allowed。いずれも retry で回復しない(recoverable=false)。
 * - `NotReadableError` は稼働中のハードウェア読取失敗 → phase="execute" / not-readable。
 * - それ以外(SensorErrorEvent の他 name / "error" fallback)は phase="execute" /
 *   sensor-error。
 */
export function deriveMagnetometerErrorInfo(name: string, message: string): WcsIoErrorInfo {
  if (name === "unsupported") {
    return { code: WCS_MAGNETOMETER_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return { code: WCS_MAGNETOMETER_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
  }
  if (name === "NotReadableError") {
    return { code: WCS_MAGNETOMETER_ERROR_CODE.NotReadable, phase: "execute", recoverable: false, message };
  }
  return { code: WCS_MAGNETOMETER_ERROR_CODE.SensorError, phase: "execute", recoverable: false, message };
}
