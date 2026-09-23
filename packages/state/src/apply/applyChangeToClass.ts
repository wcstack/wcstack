import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToClass(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const className = binding.propSegments[1];
  // 「値が無い」（undefined / null）はクラスを外す — 要件 B8 の `attr.` と同じ語彙。
  // throw にしていると、使い回した行に値の無い行オブジェクトが来たときに**行ごと**描かれなかった
  // （`attr.title:` は属性が消えるだけで済んでいた）
  if (newValue === undefined || newValue === null) {
    element.classList.toggle(className, false);
    return;
  }
  // truthy な非 boolean（`class.on: label` に文字列が来る等）は今も throw する。クラスの束縛は
  // 真偽の切り替えなので、truthy な文字列は意図より書き間違いである方がずっと多い。ただし
  // **行の中で throw すると行ごと描かれない**という失敗モードは残るので、この取り違えは
  // 静的検出（`@wcstack/lint` / VS Code 拡張のパス型推論）で前に倒す方針。
  // 作者が truthy 扱いを意図しているなら `class.on: flag|truthy` と書く（README の B8 節）。
  if (typeof newValue !== 'boolean') {
    raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}. Write "|truthy" if you mean to coerce.`);
  }
  element.classList.toggle(className, newValue as boolean);
}