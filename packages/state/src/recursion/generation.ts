/**
 * recursion/generation.ts
 *
 * 再帰レジストリの**世代の後始末**。state の再セットで前世代のレジストリが捨てられるとき、
 * その世代が生やしたもの — own の生成アクセサ・依存表の辺・評価結果のキャッシュ — を忘れる。
 * レジストリ本体（宣言の検証・パス族の代数・遅延実体化）から切り出してある: ここだけが
 * 依存表・キャッシュ・台帳という state 全体の構造に触る。
 */

import { IStateElement } from "../components/types";

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
 * 前世代が生やしたものを忘れる（state の再セット時に呼ぶ）。忘れるのは 2 つ。
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
 * **評価結果のキャッシュは忘れない。** 同じ state オブジェクト（または同じ配列）の再セットでは
 * 台帳が配列の identity をキーにしているので ListIndex も絶対アドレスも世代を跨いで同一のまま残り、
 * かつては旧世代の `dirty:false` の値がそのまま次の読みに返っていた（第 2・第 4 サイクルで実測）。
 * これは後から入った**世代印**（`cache/types.ts` の `generation`。`3bfb92a6`）が構造的に塞いでいる:
 * キャッシュを載せる 2 か所（`getByAddress` / `setByAddress`）が必ず現世代の印を付け、読みは
 * `cacheEntry.generation === stateElement.stateGeneration` の項目しかヒットにしない。この関数は
 * `runPreCommit` から呼ばれ、`_stateGeneration++` はその**直後**（`components/State.ts`）なので、
 * ここで消せる項目はどれみち必ず世代不一致で miss になる。掃き出しは `O(生成パス数 × 行数)` の
 * 純粋な無駄仕事だったので外した（番人は `integration.recursionGetter.test.ts` の再セット 4 本 —
 * 世代印を壊すとこの 4 本が落ちる）。
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
}
