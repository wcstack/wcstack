/**
 * recursion/setAllRecursive.ts
 *
 * `$setAll("<anchor>.**.<suffix>", [], value)` — **全深さへのブロードキャスト**
 * （設計書 D8 / §7-3）。
 *
 * 読み（`$getAll` の合併形）と同じ列挙を使い、同じ順序で書く。許すのは `[]` の
 * ブロードキャストだけで、mapper と `{ spread: true }` は受け付けない:
 *
 * - **mapper** の `(current, ...indexes)` は、深さごとに添字の本数が変わるので
 *   そのままでは渡せない。深さを渡す別のシグネチャを決めてから入れる。
 * - **`{ spread: true }`** は「マッチ順に 1 件ずつ配る」形。順序は決定的に定義できるが、
 *   木に 1 次元配列を配るのは作者が走査順を知らないと使えず、実用にならない。
 *
 * 添字の省略も受け付けない。`$setAll` は「書き込み API に暗黙の文脈依存を持たせない」
 * という既存の決定（docs/state-set-all-design.md の D4）を継ぐので、読み側にある
 * 省略形（文脈束縛）の対応物を書き側には置かない。
 */

import { DELIMITER } from "../define";
import { setAllValueKindMessage } from "../pathDiagnostics";
import { setByAddress } from "../proxy/methods/setByAddress";
import { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";
import { splitRecursivePath } from "./expand";
import { IRecursionSpec } from "./types";
import { collectRecursiveAddresses } from "./walk";

/**
 * 接尾辞が「再帰の構造そのもの」を名指していないか。
 *
 * ノード自身（`nodes.**`）と子リスト（`nodes.**.children`）と子ノード
 * （`nodes.**.children.*`）は、書き換えると確定済みの子アドレスを壊す。初版は
 * 葉の属性の更新に限る（実装計画 §1-3）。判定対象は宣言から導出する。
 */
function assertNotStructural(spec: IRecursionSpec, path: string, suffix: string): void {
  const repeatSegments = spec.repeat.split(DELIMITER);
  const repeatList = repeatSegments.slice(0, -1).join(DELIMITER);
  const unit = DELIMITER + spec.repeat;
  let rest = suffix;
  while (rest.startsWith(unit)) {
    rest = rest.slice(unit.length);
  }
  // 反復サブパスを**途中まで**名指す形はすべて構造。`children.*` なら "" と ".children"、
  // `branch.children.*` なら "" / ".branch" / ".branch.children"。`"." + repeatList` との
  // 完全一致だけを見ると、多段の repeat で途中のオブジェクト（`nodes.**.branch`）が素通りし、
  // 深さ 0 の `branch` を置き換えた瞬間に、この書き込みが確定済みの深さ 1 のアドレス
  // （`nodes.*.branch.children.*.…`）が宙に浮く（着地後レビューで実測。実装計画 §7-3）。
  //
  // 子リストの `length`（`nodes.**.children.length`）も構造。`arr.length = 0` は配列を
  // 切り詰めるので、リストそのものを置き換えるのと同じく、この書き込みが確定した
  // 深い側のアドレスを消す（実測: 全深さの children が空になり、集計は旧値のまま残った）。
  let structural = rest.length === 0 || rest === DELIMITER + repeatList + DELIMITER + "length";
  for (let i = 1; !structural && i < repeatSegments.length; i++) {
    structural = rest === DELIMITER + repeatSegments.slice(0, i).join(DELIMITER);
  }
  if (structural) {
    raiseError(
      `[wcs/recursion-structural-write] "${path}" writes the recursion structure itself ` +
      `(a node, its "${repeatList}" list or that list's length, or an object on the way to that list). ` +
      `This version broadcasts to leaf properties only — ` +
      `replacing a node would invalidate the child addresses already resolved for this write.`
    );
  }
}

export function setAllRecursive(
  target: object,
  receiver: any,
  handler: IStateHandler,
  path: string,
  indexes: number[] | undefined,
  value: any,
  options: { readonly spread?: boolean } | undefined,
): number {
  // 呼び出し元（setAll.ts）は `hasRecursion === true` をゲートにしているので必ずある。
  const registry = handler.stateElement.recursionRegistry!;
  const parts = splitRecursivePath(registry.spec, path);
  if (parts === null) {
    raiseError(
      `[wcs/recursion-anchor] "${path}" does not match the declared recursion anchor ` +
      `"${registry.spec.recursiveAnchor}". This version supports exactly one anchor per state.`
    );
  }

  // --- 形の検査は列挙より前（1 件も書かないことを保証する。設計 §7-3） ---
  if (!Array.isArray(indexes)) {
    raiseError(setAllValueKindMessage(
      path, `with "**" requires an explicit empty indexes array ([]) — the write API takes no context.`));
  }
  if (indexes.length > 0) {
    raiseError(
      `[wcs/recursion-setall-form] $setAll("${path}", indexes, …) with "**" takes no partial prefix: ` +
      `a prefix cannot say which depth it applies to. Pass [] to broadcast to every depth.`
    );
  }
  if (typeof value === "function") {
    raiseError(setAllValueKindMessage(
      path, `with "**" does not take a mapper yet — the index tuple has a different length at each depth.`));
  }
  if (options?.spread === true) {
    raiseError(setAllValueKindMessage(
      path, `with "**" does not take { spread: true } — handing a flat array to a tree needs the author ` +
      `to know the walk order, which is not a usable contract.`));
  }
  assertNotStructural(registry.spec, path, parts.suffix);
  const conflicting = registry.conflictingRecursiveGetter(parts.suffix);
  if (conflicting !== null) {
    raiseError(
      `[wcs/recursion-readonly] "${path}" writes into the recursive getter "${conflicting}", which has ` +
      `no setter — the two name the same family of concrete paths (or this path points inside the value ` +
      `that getter derives). Write the values it derives from instead.`
    );
  }

  // --- 第 1 相: 書き込み先を全部確定する ---
  // **観測したリスト値は基準へ確定する。** 固定 arity の `$setAll` は
  // `commitDiffBaseline: false` で走るが、あれは「読みの私有基準を書きから動かさない」
  // という E1 以前の所有権モデルの話で、いまの基準は読み・描画・依存ウォークが共有する
  // state 側の正本である（実装計画 §3-2 の E1）。
  //
  // 確定しないと cold（読みも描画も一度も走っていない）状態の `$setAll` が全深さぶんの
  // ListIndex 世代を鋳造したまま基準を残さず、次の構造変更でその世代が見えない diff が
  // 行を鋳造し直す。生き残った深い children の台帳だけが死んだ世代の親を指し、以後
  // 再帰 getter の読みが恒久的に落ちる（値の合併は動き続けるので無症状のまま進む）。
  // 1 件も書かない `undefined` のブロードキャストでも同じなので、「書き込み 0 件」は
  // 「状態が動いていない」を意味しない。
  const addresses = collectRecursiveAddresses(
    target, receiver, handler, registry.spec, parts.suffix, { commitDiffBaseline: true });

  // --- 第 2 相: 確定したアドレスにだけ書く ---
  let written = 0;
  for (let i = 0; i < addresses.length; i++) {
    // undefined は常にスキップ（設計 §5）。クリアは null。
    if (typeof value === "undefined") {
      continue;
    }
    setByAddress(target, addresses[i], value, receiver, handler);
    written++;
  }
  return written;
}
