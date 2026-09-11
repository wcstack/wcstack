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
import { recursionAnchorMismatchMessage, setAllValueKindMessage } from "../pathDiagnostics";
import { setByAddress } from "../proxy/methods/setByAddress";
import { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";
import { indexSegmentsToWildcard, isStructuralSuffix, splitRecursivePath } from "./expand";
import { IRecursionSpec } from "./types";
import { collectRecursiveAddresses } from "./walk";

/**
 * 接尾辞が「再帰の構造そのもの」を名指していないか（述語は expand.ts の `isStructuralSuffix`）。
 *
 * ノード自身（`nodes.**`）と子リスト（`nodes.**.children`）と子ノード
 * （`nodes.**.children.*`）と子リストの `length` は、書き換えると確定済みの子アドレスを壊す。
 * 初版は葉の属性の更新に限る（実装計画 §1-3）。判定対象は宣言から導出する。
 */
function assertNotStructural(spec: IRecursionSpec, path: string, suffix: string): void {
  if (isStructuralSuffix(spec, suffix)) {
    const repeatList = spec.repeat.slice(0, spec.repeat.lastIndexOf(DELIMITER));
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
  indexes: unknown,
  value: any,
  options: { readonly spread?: boolean } | undefined,
): number {
  // 呼び出し元（setAll.ts）は `hasRecursion === true` をゲートにしているので必ずある。
  const registry = handler.stateElement.recursionRegistry!;
  const suffix = splitRecursivePath(registry.spec, path);
  if (suffix === null) {
    raiseError(recursionAnchorMismatchMessage(path, registry.spec.recursiveAnchor));
  }
  // 検査には添字を `*` に畳んだ接尾辞を掛ける。`nodes.**.children.0`（子ノード）・
  // `nodes.**.children.0.children`（孫リスト）・`nodes.**.children.0.total`（getter の展開形）は
  // 添字綴りのままだと素の文字列一致をすり抜け、構造を置き換えたり部分書き込みの途中で
  // 生の TypeError になったりしていた（第 2 サイクルのレビューで実測）。列挙は綴りのまま
  // 行う — 接尾辞の添字は「その子だけ」を指す意味を持つ。
  // 接尾辞は `.` で始まる（先頭の空セグメントは区切りの都合）ので、区切りの後ろだけを畳む。
  const checkedSuffix = suffix.length === 0
    ? suffix
    : DELIMITER + indexSegmentsToWildcard(suffix.slice(DELIMITER.length));

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
  assertNotStructural(registry.spec, path, checkedSuffix);
  const conflicting = registry.conflictingRecursiveGetter(checkedSuffix);
  if (conflicting !== null) {
    raiseError(
      `[wcs/recursion-readonly] "${path}" writes into the recursive getter "${conflicting}", which has ` +
      `no setter — the two name the same family of concrete paths (or this path points inside the value ` +
      `that getter derives). Write the values it derives from instead.`
    );
  }

  // --- 第 1 相: 書き込み先を全部確定する ---
  // **観測したリスト値は基準へ確定する**（走査が必ず行う — walk.ts）。固定 arity の
  // `$setAll` は `commitDiffBaseline: false` で走るが、あれは「読みの私有基準を書きから
  // 動かさない」という E1 以前の所有権モデルの話で、いまの基準は読み・描画・依存ウォークが
  // 共有する state 側の正本である（実装計画 §3-2 の E1）。
  //
  // 確定しないと cold（読みも描画も一度も走っていない）状態の `$setAll` が全深さぶんの
  // ListIndex 世代を鋳造したまま基準を残さず、次の構造変更でその世代が見えない diff が
  // 行を鋳造し直す。生き残った深い children の台帳だけが死んだ世代の親を指し、以後
  // 再帰 getter の読みが恒久的に落ちる（値の合併は動き続けるので無症状のまま進む）。
  // 1 件も書かない `undefined` のブロードキャストでも同じなので、「書き込み 0 件」は
  // 「状態が動いていない」を意味しない。
  const addresses = collectRecursiveAddresses(target, receiver, handler, registry.spec, suffix);

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
