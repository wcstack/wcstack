import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

/**
 * カスタム要素の state プロパティバインディング（`state[.sub]: path`）に対する
 * 適用のルート先（apply/applyChange.ts の resolveCustomElementApply）。
 *
 * v2 では state プロパティのバインディングは全てマウント（webComponent/mountScope.ts）で、
 * 配送は「翻訳されたバインディング＋単一台帳＋静的依存」が担う — 親→子の再読込
 * 通知チャネル（v1 の innerState への $postUpdate）はこの経路では何も運ぶものが無い。
 * 完了済みの (element, stateProp) への適用は意図的な no-op。
 *
 * 未完了（宣言前）の適用はここへ来ない（applyChangeToProperty の積み、または
 * skipPendingMountWrite — apply/applyChange.ts）。
 */
export function applyChangeToWebComponent(_binding: IBindingInfo, _context: IApplyContext, _newValue: unknown): void {
  // no-op（上記）
  return;
}
