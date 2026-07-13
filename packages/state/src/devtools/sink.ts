/**
 * devtools/sink.ts
 *
 * 計装点が参照するホットパス唯一の接点。依存ゼロの葉モジュールにすることで、
 * 計装される側（stateElementByName / setByAddress / binding / token）と
 * bridge の間の循環 import を避ける。
 *
 * コスト規範（protocol §1-1）: フック未接続時、計装点のコストは
 * `devtoolsSink !== null` の分岐 1 個。イベントオブジェクトの生成は
 * 必ずこのチェックの内側で行うこと。
 */

import type { DevtoolsSink } from "./types";

/** live binding としてエクスポート。計装点は `if (devtoolsSink !== null)` で参照する */
export let devtoolsSink: DevtoolsSink | null = null;

export function setDevtoolsSink(sink: DevtoolsSink | null): void {
  devtoolsSink = sink;
}
