/**
 * propagation/propagation.ts
 *
 * Phase 3 の因果伝播コア（feature flag `enablePropagationContext` 下）。
 * 依存は types のみの葉モジュールとし、twowayHandler / applyChangeToProperty /
 * setByAddress / updater の計装点から循環 import なしで参照できるようにする。
 *
 * wire 識別は (node × member × stateName × statePathName) で行う。設計書の
 * WriteReceipt は bindingId + generation を持つが、twoway handler は共有
 * handler（handlerByHandlerKey）で binding インスタンスに到達できないため、
 * runtime の edge / receipt 照合キーは wire 単位とする。BindingSession
 * generation との統合（再 attach 後の edge ID 非再利用）は session 側の
 * 計装が揃う段階で bindingGeneration に反映する。
 */

import { IPropagationContext, IWriteReceipt } from "./types";

export type PropagationEdgeDirection = "to-element" | "to-state";

let nextWireId = 1;
let nextTransactionId = 1;
let nextSynchronousScopeId = 1;

// node を強参照しない wire 台帳。inner key = `${stateName}::${statePathName}::${member}`
const wireIdsByNode = new WeakMap<Node, Map<string, number>>();

function wireKey(member: string, stateName: string, statePathName: string): string {
  return `${stateName}::${statePathName}::${member}`;
}

/**
 * wire（配線）の安定 ID を返す。edge ID の基底と receipt の bindingId に使う。
 */
export function getWireId(
  node: Node,
  member: string,
  stateName: string,
  statePathName: string,
): number {
  let byKey = wireIdsByNode.get(node);
  if (typeof byKey === "undefined") {
    byKey = new Map();
    wireIdsByNode.set(node, byKey);
  }
  const key = wireKey(member, stateName, statePathName);
  let wireId = byKey.get(key);
  if (typeof wireId === "undefined") {
    wireId = nextWireId++;
    byKey.set(key, wireId);
  }
  return wireId;
}

/** wire × 方向 → edge ID。方向を含めるため再利用されない */
export function getEdgeId(wireId: number, direction: PropagationEdgeDirection): number {
  return direction === "to-element" ? wireId * 2 : wireId * 2 + 1;
}

const EMPTY_EDGES: ReadonlySet<number> = new Set<number>();

/** 外部 event / API update ごとの transaction 開始。current context は変更しない */
export function beginPropagationTransaction(originBindingId: number): IPropagationContext {
  return {
    transactionId: nextTransactionId++,
    originBindingId,
    visitedEdges: EMPTY_EDGES,
    hop: 0,
  };
}

/** edge を 1 つ通過した新しい context を返す（visitedEdges 追加・hop+1） */
export function extendPropagationContext(
  context: IPropagationContext,
  edgeId: number,
): IPropagationContext {
  const visitedEdges = new Set(context.visitedEdges);
  visitedEdges.add(edgeId);
  return {
    transactionId: context.transactionId,
    originBindingId: context.originBindingId,
    visitedEdges,
    hop: context.hop + 1,
  };
}

// 同期 dynamic scope の current context（updater drain / element 書き込み中に設定）
let currentContext: IPropagationContext | null = null;

export function getCurrentPropagationContext(): IPropagationContext | null {
  return currentContext;
}

export function runWithPropagationContext<T>(
  context: IPropagationContext | null,
  callback: () => T,
): T {
  const previous = currentContext;
  currentContext = context;
  try {
    return callback();
  } finally {
    currentContext = previous;
  }
}

// WriteReceipt: 同期 scope 限定のスタック。scope 終了時に必ず破棄される
interface IActiveWriteReceipt {
  readonly receipt: IWriteReceipt;
  readonly node: Node;
}

const receiptStack: IActiveWriteReceipt[] = [];

/**
 * state → element 書き込みを receipt scope で包んで実行する。
 * setter が同期 dispatch する event は matchWriteReceipt でこの receipt を観測できる。
 */
export function runWithWriteReceipt<T>(
  node: Node,
  member: string,
  writtenValue: unknown,
  bindingId: number,
  transactionId: number,
  callback: () => T,
): T {
  const receipt: IWriteReceipt = {
    bindingId,
    bindingGeneration: 0,
    member,
    transactionId,
    synchronousScopeId: nextSynchronousScopeId++,
    writtenValue,
  };
  receiptStack.push({ receipt, node });
  try {
    return callback();
  } finally {
    receiptStack.pop();
  }
}

/**
 * (node, member) に対する最も内側の active receipt を返す。
 * confirmation / normalization の判定（writtenValue との Object.is 比較）は
 * 呼び出し側が行う。scope 外（非同期に届いた event）では null。
 */
export function matchWriteReceipt(node: Node, member: string): IWriteReceipt | null {
  for (let i = receiptStack.length - 1; i >= 0; i--) {
    const active = receiptStack[i];
    if (active.node === node && active.receipt.member === member) {
      return active.receipt;
    }
  }
  return null;
}

// テスト用
export const __private__ = {
  receiptStack,
};
