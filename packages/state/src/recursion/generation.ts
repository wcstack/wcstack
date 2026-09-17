/**
 * recursion/generation.ts
 *
 * 再帰レジストリの**世代の後始末**。state の再セットで前世代のレジストリが捨てられるとき、
 * その世代が生やしたもの — own の生成アクセサ・依存表の辺・評価結果のキャッシュ — を忘れる。
 * レジストリ本体（宣言の検証・パス族の代数・遅延実体化）から切り出してある: ここだけが
 * 依存表・キャッシュ・台帳という state 全体の構造に触る。
 */

import { getTreePath } from "../address/TreePath";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { setCacheEntryByAbsoluteStateAddress } from "../cache/cacheEntryByAbsoluteStateAddress";
import { IStateElement } from "../components/types";
import { getListIndexesByList } from "../list/listIndexesByList";
import { IListIndex } from "../list/types";

/**
 * この機構が生やした getter。作者が手で書いた同名 getter と見分けるために使う
 * （前者は忘れてよい・後者は衝突として拒否する）。
 */
const generatedGetters: WeakSet<object> = new WeakSet();

export function markGeneratedGetter(getter: object): void {
  generatedGetters.add(getter);
}

/** この機構の生成物か（own に残った生成 getter）。 */
export function isGeneratedGetter(descriptor: PropertyDescriptor): boolean {
  return typeof descriptor.get === "function" && generatedGetters.has(descriptor.get);
}

/**
 * 前世代が生やしたものを忘れる（state の再セット時に呼ぶ）。忘れるのは 3 つ。
 *
 * **own の生成アクセサ。** 生成 getter は state オブジェクトの own プロパティとして残る。
 * 同じオブジェクトを `$recursion` 無し（または別アンカー）で再セットしたとき、残したままだと
 * `getStateInfo` が `getterPaths` に拾い直し、読むと作者が書いていない `nodes.**.value` を
 * 名指す `wcs/recursion-unsupported` になる（第 4 サイクルで実測）。`getStateInfo` の
 * **前**に消す。
 *
 * **依存辺。** `_state` のセッタは `_listPaths` / `_getterPaths` / `_pathSet` をクリアするが、
 * 依存表（`_staticDependency` / `_dynamicDependency`）は state の寿命を越えて残る。
 * 通常のパスはそれで正しい — 同じ綴りのパスは新しい state でも同じ意味を持つ。
 * だが**生成アクセサは違う**。新しい世代ではまだ実体化されておらず、それを指す辺だけが
 * 残ると、次の構造書き込みで依存ウォークが「アクセサの無い具体パス」へ降りて落ちる。
 * 依存表そのものをクリアしてはならない（既存バインディングの辺まで消えて、再セット後の
 * 集計が更新されなくなる — 実測済み）。この世代が作った辺だけを外す。
 *
 * **キャッシュ。** 辺を外した以上、生成アクセサの評価結果も一緒に落とさなければ
 * ならない。同じ state オブジェクト（または同じ配列）を再セットすると、台帳は配列の
 * identity をキーにしているので ListIndex も絶対アドレスも世代を跨いで同一のまま残り、
 * 旧世代の `dirty:false` の値がそのまま次の読みに返る。辺が無いので、次に再帰 getter を
 * 読むまでの間の構造書き込み（`nodes.0.children = […]`）はそれを dirty にできない。
 * 別のオブジェクト・別の配列なら ListIndex が新しく鋳造されるので何も残らない。
 */
export function forgetGeneration(
  stateElement: IStateElement,
  previousState: object,
  generatedPaths: ReadonlySet<string>,
): void {
  if (generatedPaths.size === 0) {
    return;
  }
  for (const path of generatedPaths) {
    const descriptor = Object.getOwnPropertyDescriptor(previousState, path);
    if (typeof descriptor !== "undefined" && isGeneratedGetter(descriptor)) {
      delete (previousState as Record<string, unknown>)[path];
    }
  }
  for (const map of [stateElement.staticDependency, stateElement.dynamicDependency]) {
    for (const path of generatedPaths) {
      map.delete(path);
    }
    for (const [source, targets] of map) {
      let kept: string[] | null = null;
      for (let i = 0; i < targets.length; i++) {
        if (generatedPaths.has(targets[i])) {
          kept ??= targets.slice(0, i);
          continue;
        }
        kept?.push(targets[i]);
      }
      if (kept !== null) {
        if (kept.length === 0) {
          map.delete(source);
        } else {
          map.set(source, kept);
        }
      }
    }
  }
  forgetCacheEntries(stateElement, previousState, generatedPaths);
}

/**
 * 生成アクセサの評価結果のキャッシュを落とす。生成パスごとに、その `wildcardParentPathInfos`
 * （`nodes` / `nodes.*.children` / … に加えて、接尾辞側のリスト `nodes.*.tags` 等）を旧 state の
 * データと台帳に沿って降り、末端の行 ListIndex で絶対アドレスを引く。
 *
 * 深さ方向だけを降りて「ノード行の ListIndex × その深さのパス」で引くのでは足りない —
 * 接尾辞にワイルドカードを持つ getter（`get "nodes.**.tags.*.up"()`）のキャッシュは
 * タグ行の ListIndex（連鎖長 depth+2）に載っていて、ノード行の ListIndex では届かない
 * （第 2 サイクルのレビューで実測: 再セット後の読みが旧値のまま残った）。
 */
function forgetCacheEntries(
  stateElement: IStateElement,
  previousState: object,
  generatedPaths: ReadonlySet<string>,
): void {
  for (const concretePath of generatedPaths) {
    const pathInfo = getPathInfo(concretePath);
    const absPathInfo = getTreePath(stateElement, pathInfo);
    const lists = pathInfo.wildcardParentPathInfos;
    const forget = (owner: unknown, ownerListIndex: IListIndex | null, level: number): void => {
      if (level === lists.length) {
        setCacheEntryByAbsoluteStateAddress(createAbsoluteStateAddress(absPathInfo, ownerListIndex), null);
        return;
      }
      // 直前のリストの行（または state のルート）から、次のリストまでの相対セグメントを辿る
      const from = level === 0 ? 0 : lists[level - 1].segments.length + 1;
      let list: any = owner;
      for (const segment of lists[level].segments.slice(from)) {
        list = list?.[segment];
      }
      if (!Array.isArray(list)) {
        return;
      }
      // 台帳が無い ＝ 走査を一度も経ていないリスト。その行に絶対アドレスは作られていない。
      const rows = getListIndexesByList(list);
      if (rows === null) {
        return;
      }
      const count = Math.min(rows.length, list.length);
      for (let i = 0; i < count; i++) {
        forget(list[i], rows[i], level + 1);
      }
    };
    forget(previousState, null, 0);
  }
}
