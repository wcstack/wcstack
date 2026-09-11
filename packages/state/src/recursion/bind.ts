/**
 * recursion/bind.ts
 *
 * オーサリング層の `**` を「いま評価している深さ」へ束縛する。
 *
 * 深さの根拠は**生成アクセサのアドレス**であって、文字列中の反復語の出現数ではない。
 * `getByAddress` は getterPaths に載るパスを読むときアドレスをスタックへ積むので、
 * 深さ k の再帰 getter の本体を評価している最中は、スタック先頭がその具体パスの
 * アドレスになっている。そこから深さを復元する（実装計画 §1-2）。
 *
 * 見るのは**スタック先頭だけ**である。添字（ListIndex）を供給する `getContextListIndex` /
 * `$getAll` の省略形も先頭しか見ないので、深さだけを外側のフレームから拾うと「深さは
 * 束縛されたが行は無い」という定義にない状態になる — `**` getter が別の素の getter を
 * 経由して `**` を読む形（`get "nodes.**.x"() { return this.helper }` /
 * `get helper() { return this["nodes.**.value"] }`）がそれで、直接読みは生の
 * `ListIndex not found`、`$getAll` の省略形は「束縛した深さ × 全行」という値を無言で
 * 返していた。深さと行は同じフレームから取る。
 */

import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { IStateHandler } from "../proxy/types";
import { recursionAnchorMismatchMessage } from "../pathDiagnostics";
import { raiseError } from "../raiseError";
import { splitRecursivePath } from "./expand";
import type { RecursionRegistry } from "./registry";

/**
 * 具体パスの**接頭辞**として最深のノードパスを見つけ、その深さを返す。
 * `nodes.*.children.*.label` のような行 getter の文脈から深さ 1 を取り出す用。
 */
function depthOfConcretePathPrefix(registry: RecursionRegistry, path: string): number | null {
  const spec = registry.spec;
  if (!path.startsWith(spec.anchor)) {
    return null;
  }
  const unit = DELIMITER + spec.repeat;
  let depth = 0;
  let cursor = spec.anchor.length;
  while (path.startsWith(unit, cursor)) {
    cursor += unit.length;
    depth++;
  }
  // 接頭辞の直後はパス境界（末尾、または `.`）でなければならない。
  if (cursor !== path.length && path.charCodeAt(cursor) !== 46 /* '.' */) {
    return null;
  }
  return depth;
}

/**
 * 評価中のアドレス（スタック先頭）から再帰の深さを求める。再帰文脈でなければ null。
 * 先頭が null（ループ文脈の無いイベントハンドラ・初期同期）も再帰文脈ではない。
 */
export function currentRecursionDepth(handler: IStateHandler, registry: RecursionRegistry): number | null {
  if (handler.addressStackLength === 0) {
    return null;
  }
  const address = handler.lastAddressStack;
  if (address === null) {
    return null;
  }
  const accessor = registry.accessorFor(address.pathInfo.path);
  if (accessor !== null) {
    return accessor.depth;
  }
  // 生成アクセサでなくても、宣言に合致する具体パス（行 getter・行のイベントハンドラが
  // 積むループのアドレス）ならそこから深さを取れる。
  return depthOfConcretePathPrefix(registry, address.pathInfo.path);
}

/**
 * `**` を含むパスを、いま評価している深さの具体パスへ書き換える。
 * 再帰文脈が無いところで `**` を直接読むのは、深さが決まらないので診断する。
 */
export function bindRecursivePath(
  stateElement: IStateElement,
  handler: IStateHandler,
  path: string,
): string {
  // 呼び出し元は 2 つとも `hasRecursion === true` をゲートにしているので、
  // ここに来た時点でレジストリは必ずある。到達不能な `??` 分岐は置かない
  // （カバレッジ閾値に効く — walkDependency の `address.listIndex!` と同じ綴り）。
  const registry = stateElement.recursionRegistry!;
  // アンカー照合を先に行う。深さ解決を先にすると、綴り違いのアンカーが
  // 「文脈が無い」と報告されて原因に辿り着けない。
  const suffix = splitRecursivePath(registry.spec, path);
  if (suffix === null) {
    raiseError(recursionAnchorMismatchMessage(path, registry.spec.recursiveAnchor));
  }
  const depth = currentRecursionDepth(handler, registry);
  if (depth === null) {
    raiseError(
      `[wcs/recursion-context] "${path}" uses "**", which is bound to the depth of the recursive getter ` +
      `being evaluated, and there is no recursion context here. Read it from inside a recursive getter ` +
      `or a row getter under "${registry.spec.anchor}", or name a concrete depth ` +
      `(for example "${registry.spec.anchor}${path.slice(registry.spec.recursiveAnchor.length)}"). ` +
      `The depth comes from the innermost frame only: a plain getter reached from a recursive getter ` +
      `has no row of its own, so read "**" in the recursive getter and pass the value on.`
    );
  }
  // 照合済みの接尾辞をそのまま使う。具体パスは記憶付き（再帰 getter の評価ごとに通る経路）。
  return registry.concretePathAt(suffix, depth);
}
