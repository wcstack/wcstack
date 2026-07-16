/**
 * propagation/types.ts
 *
 * Phase 3（docs/architecture-hardening/09-remediation-design.md §4）の
 * 因果伝播レコード型。エコー判定を値比較ではなく edge provenance で行う。
 *
 * - transaction: 外部 event / API update ごとに 1 つ開始する
 * - edge: binding の配線（node × member × state address）× 方向。同じ transaction が
 *   同じ edge を再度通ろうとした場合だけ伝播を抑止する
 * - WriteReceipt: state → element 書き込みの同期 dynamic scope に置き、同じ
 *   setter call stack 内で同じ member から `Object.is` 同値の通知が戻った場合
 *   だけ confirmation として再伝播を抑止する
 *
 * context は wc-bindable の event detail / property 値へ混入させず、
 * state runtime 内部（module dynamic scope と updater queue record）だけで運ぶ。
 */

export interface IPropagationContext {
  readonly transactionId: number;
  /** 起点 wire の ID。API update（binding 外からの state 書き込み）は -1 */
  readonly originBindingId: number;
  readonly visitedEdges: ReadonlySet<number>;
  readonly hop: number;
}

export interface IWriteReceipt {
  readonly bindingId: number;
  readonly bindingGeneration: number;
  readonly member: string;
  readonly transactionId: number;
  readonly synchronousScopeId: number;
  readonly writtenValue: unknown;
}

/** updater queue の update record（address + 書き込み時点の因果 context） */
export interface IUpdateRecord {
  readonly context: IPropagationContext | null;
}
