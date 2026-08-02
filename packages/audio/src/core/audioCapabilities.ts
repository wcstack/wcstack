/**
 * audioCapabilities.ts
 *
 * Web Audio 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。
 *
 * この node の失敗経路は 2 つだけ:
 *   1. `AudioContext` コンストラクタ自体が不在(synthetic "unsupported")。
 *   2. `resume()` / `suspend()` の rejection — ほぼ常にユーザージェスチャ不足。
 *
 * グラフ配線の不整合(解決できない `out="..."` 等)は error ではなく **warning** に
 * 出す。1 本の配線ミスでパッチ全体を失敗扱いにすると、鳴らせるはずの残り全部まで
 * 落ちるため(never-throw の精神)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した audio error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_AUDIO_ERROR_CODE = {
  /** `AudioContext` / `webkitAudioContext` が不在(synthetic "unsupported")。 */
  CapabilityMissing: "capability-missing",
  /**
   * `NotAllowedError` — ユーザージェスチャ前の `resume()`。ジェスチャ後の再試行で
   * 回復する。
   */
  NotAllowed: "not-allowed",
  /** その他の context 操作失敗。 */
  ContextError: "context-error",
} as const;

/**
 * Web Audio の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:
 * - `"unsupported"` — API 不在 → phase="probe" / capability-missing。
 * - `NotAllowedError` — ジェスチャ不足 → phase="start" / not-allowed。recoverable。
 * - それ以外 → phase="execute" / context-error。
 */
export function deriveAudioErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo {
  if (name === "unsupported") {
    return { code: WCS_AUDIO_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "NotAllowedError") {
    return { code: WCS_AUDIO_ERROR_CODE.NotAllowed, phase: "start", recoverable: true, message };
  }
  return { code: WCS_AUDIO_ERROR_CODE.ContextError, phase: "execute", recoverable: true, message };
}
