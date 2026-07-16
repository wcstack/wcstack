import { describe, it, expect } from "vitest";
import { deriveMediaErrorInfo, WCS_MEDIA_ERROR_CODE } from "../src/core/mediaCapabilities";

/**
 * Phase 6 error taxonomy: deriveMediaErrorInfo は camera / recorder 両 Core が共有する
 * `WcsMediaErrorDetail` を serializable な WcsIoErrorInfo に写す。両 Core が実際に産む
 * 全 `.name`(getUserMedia の DOMException 群・"unsupported" sentinel・RecorderCore 固有の
 * "NoStreamError" / "RecorderError"・MediaRecorder 構築失敗の "NotSupportedError" 等)を
 * 網羅する。
 */
describe("deriveMediaErrorInfo (Phase 6 media taxonomy)", () => {
  it('"unsupported" → capability-missing / probe / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "unsupported", message: "no gUM" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message: "no gUM",
    });
  });

  it('"NotAllowedError" / "SecurityError" → not-allowed / start / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "NotAllowedError", message: "denied" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message: "denied",
    });
    expect(deriveMediaErrorInfo({ name: "SecurityError", message: "blocked" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message: "blocked",
    });
  });

  it('"NotFoundError" → not-found / start / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "NotFoundError", message: "no cam" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.NotFound, phase: "start", recoverable: false, message: "no cam",
    });
  });

  it('"NotReadableError" → not-readable / start / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "NotReadableError", message: "busy" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message: "busy",
    });
  });

  it('"OverconstrainedError" / "NotSupportedError" → invalid-argument / start / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "OverconstrainedError", message: "bad constraints" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message: "bad constraints",
    });
    // MediaRecorder 構築失敗(非対応 mimeType/構成)。
    expect(deriveMediaErrorInfo({ name: "NotSupportedError", message: "bad type" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message: "bad type",
    });
  });

  it('"NoStreamError" → invalid-state / start / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "NoStreamError", message: "no stream" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.InvalidState, phase: "start", recoverable: false, message: "no stream",
    });
  });

  it('"AbortError" → aborted / execute / recoverable=true', () => {
    expect(deriveMediaErrorInfo({ name: "AbortError", message: "aborted" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message: "aborted",
    });
  });

  it('その他(RecorderError / 想定外 runtime error / "Error" fallback)→ media-error / execute / recoverable=false', () => {
    expect(deriveMediaErrorInfo({ name: "RecorderError", message: "boom" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.MediaError, phase: "execute", recoverable: false, message: "boom",
    });
    expect(deriveMediaErrorInfo({ name: "Error", message: "weird" })).toEqual({
      code: WCS_MEDIA_ERROR_CODE.MediaError, phase: "execute", recoverable: false, message: "weird",
    });
  });
});
