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
 * したがって derive は「wrap された生の値」から name/message を取り出す。また tilt は
 * "unsupported"(capability-missing)経路を **持たない**: `DeviceOrientationEvent` や
 * その `requestPermission` が無い環境では error にせず `"granted"` に倒して error を
 * クリアする(docs/device-orientation-tag-design.md §3)。よって capability-missing の
 * code / branch は生成しない(到達不能・dead code を避ける)。error として _setError に
 * 届くのは iOS の `requestPermission()` reject だけで、その name は実権限拒否なら
 * `NotAllowedError`、gesture 文脈外等なら汎用 `Error` になる。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した tilt error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_TILT_ERROR_CODE = {
  /** `NotAllowedError` — iOS の Device Orientation 権限拒否。 */
  NotAllowed: "not-allowed",
  /** その他の `requestPermission()` reject(gesture 文脈外 / 想定外の失敗)。 */
  TiltError: "tilt-error",
} as const;

/**
 * tilt の失敗(`_setError` に渡る `{ error: <生の reason> }`)を serializable な error
 * taxonomy に写す。name は wrap された reason の `Error.name`、message はその `.message`
 * (無ければ `String(...)`)。
 *
 * - `NotAllowedError` は iOS の権限拒否 → phase="start" / not-allowed。retry で回復しない。
 * - それ以外(gesture 文脈外の汎用 `Error`、非 Error reason 等)→ phase="execute" /
 *   tilt-error。
 *
 * capability-missing 経路は無い(上のヘッダ参照): 非対応環境は error ではなく
 * `"granted"` へ倒れるため、ここには到達しない。
 */
export function deriveTiltErrorInfo(detail: { error?: any }): WcsIoErrorInfo {
  const name: string | undefined = detail.error?.name;
  const message: string = detail.error?.message ?? String(detail.error);
  if (name === "NotAllowedError") {
    return { code: WCS_TILT_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
  }
  return { code: WCS_TILT_ERROR_CODE.TiltError, phase: "execute", recoverable: false, message };
}
