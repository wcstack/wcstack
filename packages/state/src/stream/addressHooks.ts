/**
 * stream/addressHooks.ts — `$streams` を宣言した state に付く読み書き境界の hook（設計案 H1、S3）。
 * 従来 core（getByAddress / get トラップ）が直接 import していた 3 辺（argsTrace・streamNamespace）を
 * ここへ移し、`$streams` の無い state では一切走らない。
 */
import { STATE_STREAM_ERROR_NAMESPACE_NAME, STATE_STREAM_STATUS_NAMESPACE_NAME } from "../define";
import { NOT_HANDLED, IAddressHooks } from "../core/addressHooks";
import { collectStreamDependency } from "./argsTrace";
import { getStreamErrorNamespace, getStreamStatusNamespace } from "./streamNamespace";

/** namespace 配下のパスは raw state を持たないため namespace オブジェクトを辿る（getByAddress の walkNamespace と同じ規約） */
function walkNamespace(namespace: object, segments: string[]): any {
  let value: any = namespace;
  for (let i = 1; i < segments.length; i++) {
    if (Object(value) !== value) {
      return undefined;
    }
    value = Reflect.get(value, segments[i]);
  }
  return value;
}

export const streamAddressHooks: IAddressHooks = {
  read(stateElement, address) {
    // $streams の args トレース中のみ絶対アドレスを捕捉（collector 非活性なら即 return）
    collectStreamDependency(stateElement, address);
    const firstSegment = address.pathInfo.segments[0];
    if (firstSegment === STATE_STREAM_STATUS_NAMESPACE_NAME) {
      return walkNamespace(getStreamStatusNamespace(stateElement), address.pathInfo.segments);
    }
    if (firstSegment === STATE_STREAM_ERROR_NAMESPACE_NAME) {
      return walkNamespace(getStreamErrorNamespace(stateElement), address.pathInfo.segments);
    }
    return NOT_HANDLED;
  },
  get(handler, prop) {
    if (prop === STATE_STREAM_STATUS_NAMESPACE_NAME) {
      return getStreamStatusNamespace(handler.stateElement);
    }
    if (prop === STATE_STREAM_ERROR_NAMESPACE_NAME) {
      return getStreamErrorNamespace(handler.stateElement);
    }
    return NOT_HANDLED;
  },
};
