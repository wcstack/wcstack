/**
 * recursion/addressHooks.ts — `$recursion` を宣言した state に付く hook（設計案 H1、S3）。
 * 従来 core（get トラップ・`$getAll` / `$setAll`・setByAddress）が直接 import していた `**` の
 * 束縛・合併形・書き込み禁止をここへ移し、宣言の無い state では一切走らない。
 * （`$trackDependency` の `**` 拒否は宣言の有無に関わらないので core に残る）
 */
import { getResolvedAddress } from "../address/ResolvedAddress";
import { createStateAddress } from "../address/StateAddress";
import { IAddressHooks, NOT_HANDLED, registerFeatureHooks } from "../core/addressHooks";
import { getAll } from "../proxy/apis/getAll";
import { ISetAllOptions, setAll } from "../proxy/apis/setAll";
import { getByAddress } from "../proxy/methods/getByAddress";
import { getListIndex } from "../proxy/methods/getListIndex";
import { raiseError } from "../raiseError";
import { bindRecursivePath } from "./bind";
import { hasRecursionWildcard } from "./expand";
import { getAllRecursive } from "./getAllRecursive";
import { setAllRecursive } from "./setAllRecursive";

// hook は要素の寿命の間は付いたまま（再セットで `$recursion` が消えても外れない）ので、
// 宣言が消えた後は `hasRecursion` の boolean 判定 1 個で core と同じ経路へ戻す
export const recursionAddressHooks: IAddressHooks = {
  // 再帰 getter の展開形（`nodes.*.children.*.total`）とその値の内側への書き込みは、`**` を
  // 含まないので `setAllRecursive` の読み取り専用検査を通らない。未実体化なら fast path が
  // 「親オブジェクトの未存在キー」として行オブジェクトへ素の値を書き、代入値を `dirty:false` で
  // キャッシュに載せる — ノードが汚れ、実体化後も getter が評価されず、深さ 0 の集計まで
  // 巻き込む（レビュー P18 で実測）。読み側の遅延実体化（getByAddress の E5）と対称に、書き側はここで止める
  write(stateElement, address) {
    if (stateElement.hasRecursion !== true) {
      return NOT_HANDLED;
    }
    const owner = stateElement.recursionRegistry!.recursiveGetterOwningPath(address.pathInfo);
    if (owner !== null) {
      raiseError(
        `[wcs/recursion-readonly] "${address.pathInfo.path}" writes into the recursive getter "${owner}" ` +
        `(this path is that getter at one depth, or a path inside the value it derives), which has ` +
        `no setter. Write the values it derives from instead.`
      );
    }
    return NOT_HANDLED;
  },
  get(handler, prop, receiver, target) {
    if (handler.stateElement.hasRecursion !== true) {
      return NOT_HANDLED;
    }
    if (prop === "$getAll") {
      // オーサリング層の `**`。省略形は「いま評価している深さ」に束縛し、`[]` 明示は
      // 全深さの合併になる（設計書 §6-2）。部分接頭辞は `**` に対して定義できない。
      return (path: string, indexes?: number[]): any[] => {
        if (hasRecursionWildcard(path)) {
          if (typeof indexes === "undefined") {
            path = bindRecursivePath(handler.stateElement, handler, path);
          } else {
            // アンカー照合と添字の形の検査は合併形の側で行う（判定順を静的側と揃えるため）
            return getAllRecursive(target, receiver, handler, path, indexes);
          }
        }
        return getAll(target, prop, receiver, handler)(path, indexes);
      };
    }
    if (prop === "$setAll") {
      // 書き側は `[]` のブロードキャストだけを受け付ける（形の検査は列挙より前に行い、
      // 1 件も書かないことを保証する。設計 §7-3）
      return (path: string, indexes: number[], value: any, options?: ISetAllOptions): number => {
        if (hasRecursionWildcard(path)) {
          return setAllRecursive(target, receiver, handler, path, indexes, value, options);
        }
        return setAll(target, prop, receiver, handler)(path, indexes, value, options);
      };
    }
    if (prop.charCodeAt(0) !== 36 /* '$' */ && hasRecursionWildcard(prop)) {
      // オーサリング層の `**` を、いま評価している再帰 getter の深さへ束縛して通常解決する
      const resolvedAddress = getResolvedAddress(bindRecursivePath(handler.stateElement, handler, prop));
      const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
      return getByAddress(target, createStateAddress(resolvedAddress.pathInfo, listIndex), receiver, handler);
    }
    return NOT_HANDLED;
  },
};

let installed = false;
/** 冪等。full エントリでは State が `$recursion` の宣言時に呼ぶ（分割エントリでは `install` が担う） */
export function installRecursionHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("recursion", recursionAddressHooks);
}
