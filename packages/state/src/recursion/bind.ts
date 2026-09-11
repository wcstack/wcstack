/**
 * recursion/bind.ts
 *
 * オーサリング層の `**` を「いま評価している深さ」へ束縛する。
 *
 * 深さの根拠は**生成アクセサのアドレス**であって、文字列中の反復語の出現数ではない。
 * `getByAddress` は getterPaths に載るパスを読むときアドレスをスタックへ積むので、
 * 深さ k の再帰 getter の本体を評価している最中は、スタック先頭がその具体パスの
 * アドレスになっている。そこから深さを復元する（実装計画 §1-2）。
 */

import { IStateElement } from "../components/types";
import { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";
import { concretePathAt, splitRecursivePath } from "./expand";
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
  const unit = "." + spec.repeat;
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

/** 評価中のアドレスから再帰の深さを求める。再帰文脈でなければ null。 */
export function currentRecursionDepth(handler: IStateHandler, registry: RecursionRegistry): number | null {
  for (let i = handler.addressStackLength - 1; i >= 0; i--) {
    const address = handler.addressStackAt(i);
    if (address === null) {
      continue;
    }
    const accessor = registry.accessorFor(address.pathInfo.path);
    if (accessor !== null) {
      return accessor.depth;
    }
    // 生成アクセサでなくても、宣言に合致する具体パス（行 getter・イベント経由）なら
    // そこから深さを取れる。最深のノード接頭辞を採るため、内側から外側へ探す。
    const depth = depthOfConcretePathPrefix(registry, address.pathInfo.path);
    if (depth !== null) {
      return depth;
    }
  }
  return null;
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
  // ここに来た時点でレジストリは必ずある（無ければ呼び出し側のゲート漏れ）。
  const registry = stateElement.recursionRegistry
    ?? raiseError(`Recursion registry is missing while binding "${path}"; hasRecursion must gate this call.`);
  // アンカー照合を先に行う。深さ解決を先にすると、綴り違いのアンカーが
  // 「文脈が無い」と報告されて原因に辿り着けない。
  const parts = splitRecursivePath(registry.spec, path);
  if (parts === null) {
    raiseError(
      `[wcs/recursion-anchor] "${path}" does not match the declared recursion anchor ` +
      `"${registry.spec.recursiveAnchor}". This version supports exactly one anchor per state.`
    );
  }
  const depth = currentRecursionDepth(handler, registry);
  if (depth === null) {
    raiseError(
      `[wcs/recursion-context] "${path}" uses "**", which is bound to the depth of the recursive getter ` +
      `being evaluated, and there is no recursion context here. Read it from inside a recursive getter ` +
      `or a row getter under "${registry.spec.anchor}", or name a concrete depth ` +
      `(for example "${registry.spec.anchor}${path.slice(registry.spec.recursiveAnchor.length)}").`
    );
  }
  // 照合済みの parts をそのまま使う（registry.concretePath は同じ照合をもう一度行う）。
  return concretePathAt(registry.spec, parts.suffix, depth);
}
