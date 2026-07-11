/**
 * stream/types.ts
 *
 * `$streams` adapter の型定義（docs/state-streams-design.md）。
 *
 * - StreamSource は AbortSignal を必ず尊重すること（協調キャンセル契約）。
 *   restart / 破棄はこの signal で駆動される。
 * - fold は同期関数で、毎回新しい値を返すこと（acc の in-place 変異は非サポート）。
 * - IStreamEntry の status / error は registry entry が正本
 *   （state オブジェクト上に実プロパティは持たない。$streamStatus / $streamError
 *    名前空間がここを読む）。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateProxy } from "../proxy/types";

export type StreamStatus = "idle" | "active" | "done" | "error";

export type StreamProducer<C = unknown> = AsyncIterable<C> | ReadableStream<C>;

export type StreamSource<C = unknown> = (
  args: unknown,
  signal: AbortSignal,
) => StreamProducer<C> | Promise<StreamProducer<C>>;

export type StreamFold = (acc: unknown, chunk: unknown) => unknown;

export interface IStreamDefinition {
  /** 依存捕捉用の同期関数。省略時は null（起動後 restart しない） */
  args: ((state: IStateProxy) => unknown) | null;
  source: StreamSource;
  /** 宣言で省略された場合は latest（(_, chunk) => chunk）を注入済み */
  fold: StreamFold;
  /** 起動・restart のたびに値がリセットされる初期値 */
  initial: unknown;
}

export interface IStreamEntry {
  readonly name: string;
  readonly definition: IStreamDefinition;
  status: StreamStatus;
  error: unknown;
  controller: AbortController | null;
  /**
   * 直近に成功した args 評価（traceArgs）で読まれた絶対アドレス。
   * args 省略時は空（traceArgs が clear する）。成功 run ごとに丸ごと置換され、
   * 評価失敗時は前回成功 run の検証済み捕捉を保持する（stream/argsTrace.ts §3-1）。
   */
  depAddresses: Set<IAbsoluteStateAddress>;
}

/**
 * consumeSource が状態書き込みを委譲する sink。
 * fold が throw した場合、呼び出し側（runtime）は fail 経路で
 * controller.abort() を行い producer を掃除する（設計書 §3-3）。
 */
export interface IConsumeSink {
  fold(chunk: unknown): void;
  done(): void;
  fail(error: unknown): void;
}
