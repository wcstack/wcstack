/**
 * midiCapabilities.ts
 *
 * Web MIDI 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。
 *
 * この node の失敗は 2 箇所からしか来ない:
 *   1. `requestMIDIAccess()` の rejection — 権限拒否・API 不在・sysex 拒否。
 *   2. `MIDIOutput.send()` の throw — 不正なメッセージ・切断済みポート。
 * `_setError` は screen-orientation と同じ discriminator 技法で、synthetic な
 * `"unsupported"` / `"send"` ヒントと caught された `Error.name` を弁別する
 * (message の文言に依存した分岐を作らない)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した midi error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_MIDI_ERROR_CODE = {
  /** `navigator.requestMIDIAccess` 自体が不在(synthetic "unsupported")。 */
  CapabilityMissing: "capability-missing",
  /**
   * `SecurityError` / `NotAllowedError` — ユーザーが拒否した、あるいは
   * permissions policy / 非 secure context で許可されない。retry では回復しない。
   */
  NotAllowed: "not-allowed",
  /** その他の `requestMIDIAccess()` 失敗。fresh な request は成功しうる。 */
  AccessError: "access-error",
  /** `MIDIOutput.send()` の失敗(不正なメッセージ / 切断済みポート)。 */
  SendFailed: "send-failed",
} as const;

/**
 * Web MIDI の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:
 * - `"unsupported"` — API 不在 → phase="probe" / capability-missing。
 * - `"send"` — 送信失敗 → phase="execute" / send-failed。recoverable(ポートが
 *   戻れば成功しうる)。
 * - `SecurityError` / `NotAllowedError` — 拒否 → phase="start" / not-allowed。
 * - それ以外(`AbortError`、生の throw、`.name` 欠如等) → phase="start" /
 *   access-error。
 */
export function deriveMidiErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo {
  if (name === "unsupported") {
    return { code: WCS_MIDI_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "send") {
    return { code: WCS_MIDI_ERROR_CODE.SendFailed, phase: "execute", recoverable: true, message };
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return { code: WCS_MIDI_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
  }
  return { code: WCS_MIDI_ERROR_CODE.AccessError, phase: "start", recoverable: true, message };
}
