/**
 * tiltCapabilities.ts
 *
 * Tilt(Device Orientation)node 固有の error code(taxonomy)と derivation。汎用の
 * error info 型は `./platformCapability.js`(/io-core/ から copy-distribution される
 * 生成ファイル)から import する。tilt は監視系(deviceorientation の subscribe/
 * unsubscribe)で競合する operation を持たないため lane は持たず、error taxonomy
 * (errorInfo)のみを採用する。
 *
 * sensor 4 兄弟(accelerometer / gyroscope / magnetometer / ambient-light-sensor)と
 * 違い、tilt の error 面は **異なる shape** を持つ:
 * - sensor 族の error detail は `{ error: <Error.name>, message }`(name/message は文字列)。
 * - tilt の error detail は `{ error: <生の rejection reason> }`(TiltCore._setError が
 *   `requestPermission()` の catch で `{ error: e }` を渡す。`e` は生の Error/reason)。
 *
 * したがって derive は「wrap された生の値」から name/message を取り出す。error として
 * _setError に届くのは 2 種類:
 * - iOS の `requestPermission()` の reject。タップ(user gesture)の外から呼ぶと iOS は
 *   質問を出さずに `NotAllowedError` で reject する。利用者の拒否ではない(利用者が
 *   拒否したときは reject ではなく `"denied"` で resolve する)。
 * - `DeviceOrientationEvent` そのものが無い環境(一部のデスクトップ、Windows 上の
 *   Playwright の WebKit)。`requestPermission()` / `start()` が `{ error: { name:
 *   "unsupported", message } }` を渡す → capability-missing。`DeviceOrientationEvent` は
 *   あるが `requestPermission` が無い環境(Android・デスクトップ)は error にせず
 *   `"granted"` に倒す(docs/device-orientation-tag-design.md §3)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した tilt error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_TILT_ERROR_CODE = {
  /** `DeviceOrientationEvent` がこのブラウザに無い。 */
  CapabilityMissing: "capability-missing",
  /** `NotAllowedError` — iOS が質問を出さなかった(タップの外からの `requestPermission()`)。 */
  NotAllowed: "not-allowed",
  /** その他の `requestPermission()` reject(想定外の失敗)。 */
  TiltError: "tilt-error",
} as const;

/**
 * tilt の失敗(`_setError` に渡る `{ error: <生の reason> }`)を serializable な error
 * taxonomy に写す。name は wrap された reason の `Error.name`、message はその `.message`
 * (無ければ `String(...)`)。
 *
 * - "unsupported" は API の欠如 → phase="probe" / capability-missing。回復しない。
 * - `NotAllowedError` は iOS が質問を出さなかった → phase="start" / not-allowed。タップから
 *   呼び直せば質問が出るので recoverable=true。
 * - それ以外(汎用 `Error`、非 Error reason 等)→ phase="execute" / tilt-error。
 */
export function deriveTiltErrorInfo(detail: { error?: any }): WcsIoErrorInfo {
  const name: string | undefined = detail.error?.name;
  const message: string = detail.error?.message ?? String(detail.error);
  if (name === "unsupported") {
    return { code: WCS_TILT_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "NotAllowedError") {
    return { code: WCS_TILT_ERROR_CODE.NotAllowed, phase: "start", recoverable: true, message };
  }
  return { code: WCS_TILT_ERROR_CODE.TiltError, phase: "execute", recoverable: false, message };
}
