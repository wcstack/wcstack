/**
 * speechCapabilities.ts
 *
 * speech node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。speech パッケージは 2 つの Core を持つ:
 *
 * - ListenCore(`<wcs-listen>`, SpeechRecognition / STT) — 認識セッションの
 *   start/stop/abort。監視ではなく command 駆動だが、競合する非同期 operation の lane は
 *   持たない(直近の start が単一セッションを置換する)ため、lane は採用せず error
 *   taxonomy(errorInfo)のみを追加する。
 * - SpeakCore(`<wcs-speak>`, SpeechSynthesis / TTS) — 発話キュー。同上。
 *
 * SpeechRecognitionErrorEvent と SpeechSynthesisErrorEvent は `error` enum の値集合が
 * 異なるため、taxonomy も Core ごとに別 derive を持つ。いずれの Core も error detail の
 * `.error` は既に安定コード(SpeechRecognition/SpeechSynthesis の error enum、または
 * `"unsupported"` fallback)であり Error.name ではないので、derivation は notification と
 * 同型の「`.error` コードを taxonomy に写す純粋 map」である。想定外のコードは防御的に
 * `speech-error` へ畳む。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";
import type { WcsListenErrorDetail, WcsSpeakErrorDetail } from "../types.js";

// ---------------------------------------------------------------------------
// SpeechRecognition (STT) — <wcs-listen>
// ---------------------------------------------------------------------------

/** 安定した listen(SpeechRecognition)error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_LISTEN_ERROR_CODE = {
  /** SpeechRecognition API 非対応(`SpeechRecognition` / `webkitSpeechRecognition` 不在)。 */
  CapabilityMissing: "capability-missing",
  /** `not-allowed` / `service-not-allowed` — マイク権限拒否 / サービス不許可。 */
  NotAllowed: "not-allowed",
  /** `audio-capture` — マイクが読めない(不在 / ハードウェア)。 */
  NotReadable: "not-readable",
  /** `no-speech` — 無音のまま検出できず(transient — retry で成功しうる)。 */
  NoSpeech: "no-speech",
  /** `network` — 認識バックエンドへの通信失敗(transient)。 */
  NetworkError: "network-error",
  /** `aborted` — セッションが中断された(transient)。 */
  Aborted: "aborted",
  /** `language-not-supported` / `bad-grammar` — 言語 / 文法が不正(前提条件違反)。 */
  InvalidArgument: "invalid-argument",
  /** その他 / 想定外の error code に対する防御的 fallback。 */
  SpeechError: "speech-error",
} as const;

/**
 * listen(SpeechRecognition)の失敗を serializable な error taxonomy に写す。引数は
 * `wcs-listen:error` の detail(`{ error, message }`)そのもの。`.error` は
 * `SpeechRecognitionErrorEvent.error` enum(または `"unsupported"` / `"aborted"`
 * fallback)で、Error.name ではない。
 *
 * - `"unsupported"` は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `"not-allowed"` / `"service-not-allowed"` はマイク権限拒否 → phase="start" /
 *   not-allowed。回復しない(recoverable=false)。ListenCore はこの 2 つを終端扱いにし
 *   自動再開を止める。
 * - `"audio-capture"` はマイクの読取失敗 → phase="start" / not-readable / false。
 * - `"no-speech"` / `"network"` / `"aborted"` は transient で、continuous セッションは
 *   `maxRestarts` の範囲で自動再開しうる → phase="execute" / recoverable=true。
 * - `"language-not-supported"` / `"bad-grammar"` は言語 / 文法の前提違反 →
 *   phase="start" / invalid-argument / false。
 * - それ以外(未知コード)は防御的に phase="execute" / speech-error / false。
 */
export function deriveListenErrorInfo(error: WcsListenErrorDetail): WcsIoErrorInfo {
  const { error: code, message } = error;
  switch (code) {
    case "unsupported":
      return { code: WCS_LISTEN_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    case "not-allowed":
    case "service-not-allowed":
      return { code: WCS_LISTEN_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    case "audio-capture":
      return { code: WCS_LISTEN_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message };
    case "no-speech":
      return { code: WCS_LISTEN_ERROR_CODE.NoSpeech, phase: "execute", recoverable: true, message };
    case "network":
      return { code: WCS_LISTEN_ERROR_CODE.NetworkError, phase: "execute", recoverable: true, message };
    case "aborted":
      return { code: WCS_LISTEN_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
    case "language-not-supported":
    case "bad-grammar":
      return { code: WCS_LISTEN_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    default:
      return { code: WCS_LISTEN_ERROR_CODE.SpeechError, phase: "execute", recoverable: false, message };
  }
}

// ---------------------------------------------------------------------------
// SpeechSynthesis (TTS) — <wcs-speak>
// ---------------------------------------------------------------------------

/** 安定した speak(SpeechSynthesis)error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_SPEAK_ERROR_CODE = {
  /** SpeechSynthesis API 非対応(`speechSynthesis` / `SpeechSynthesisUtterance` 不在)。 */
  CapabilityMissing: "capability-missing",
  /** `not-allowed` — 合成が許可されていない。 */
  NotAllowed: "not-allowed",
  /** `canceled` / `interrupted` — 発話がキャンセル / 中断された(transient)。 */
  Aborted: "aborted",
  /** `audio-busy` / `audio-hardware` — オーディオ出力の占有 / ハードウェア障害。 */
  NotReadable: "not-readable",
  /** `network` — 合成バックエンドへの通信失敗(transient)。 */
  NetworkError: "network-error",
  /** `language-unavailable` / `voice-unavailable` / `text-too-long` / `invalid-argument` —
   *  発話パラメータが不正 / 未対応(前提条件違反)。 */
  InvalidArgument: "invalid-argument",
  /** `synthesis-unavailable` / `synthesis-failed` — 合成そのものが失敗した。 */
  SynthesisFailed: "synthesis-failed",
  /** その他 / 想定外の error code に対する防御的 fallback。 */
  SpeechError: "speech-error",
} as const;

/**
 * speak(SpeechSynthesis)の失敗を serializable な error taxonomy に写す。引数は
 * `wcs-speak:error` の detail(`{ error, message }`)そのもの。`.error` は
 * `SpeechSynthesisErrorEvent.error` enum(または `"unsupported"` /
 * `"synthesis-failed"` fallback)で、Error.name ではない。
 *
 * - `"unsupported"` は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `"not-allowed"` は合成不許可 → phase="start" / not-allowed / false。
 * - `"canceled"` / `"interrupted"` は cancel()/後続発話による中断 → phase="execute" /
 *   aborted / recoverable=true(通常は SpeakCore の世代ガードが握りつぶすため error として
 *   表面化しないが、防御的に写す)。
 * - `"audio-busy"` はオーディオ占有で transient(retry で回復しうる)→ phase="execute" /
 *   not-readable / recoverable=true。`"audio-hardware"` はハードウェア障害で回復しない →
 *   同 not-readable だが recoverable=false。
 * - `"network"` は transient → phase="execute" / network-error / recoverable=true。
 * - `"language-unavailable"` / `"voice-unavailable"` / `"text-too-long"` /
 *   `"invalid-argument"` は発話パラメータの前提違反 → phase="start" / invalid-argument /
 *   false。
 * - `"synthesis-unavailable"` / `"synthesis-failed"` は合成実行の失敗 → phase="execute" /
 *   synthesis-failed / false。
 * - それ以外(未知コード)は防御的に phase="execute" / speech-error / false。
 */
export function deriveSpeakErrorInfo(error: WcsSpeakErrorDetail): WcsIoErrorInfo {
  const { error: code, message } = error;
  switch (code) {
    case "unsupported":
      return { code: WCS_SPEAK_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    case "not-allowed":
      return { code: WCS_SPEAK_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    case "canceled":
    case "interrupted":
      return { code: WCS_SPEAK_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
    case "audio-busy":
      return { code: WCS_SPEAK_ERROR_CODE.NotReadable, phase: "execute", recoverable: true, message };
    case "audio-hardware":
      return { code: WCS_SPEAK_ERROR_CODE.NotReadable, phase: "execute", recoverable: false, message };
    case "network":
      return { code: WCS_SPEAK_ERROR_CODE.NetworkError, phase: "execute", recoverable: true, message };
    case "language-unavailable":
    case "voice-unavailable":
    case "text-too-long":
    case "invalid-argument":
      return { code: WCS_SPEAK_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    case "synthesis-unavailable":
    case "synthesis-failed":
      return { code: WCS_SPEAK_ERROR_CODE.SynthesisFailed, phase: "execute", recoverable: false, message };
    default:
      return { code: WCS_SPEAK_ERROR_CODE.SpeechError, phase: "execute", recoverable: false, message };
  }
}
