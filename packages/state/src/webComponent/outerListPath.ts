/**
 * webComponent/outerListPath.ts
 *
 * mapped な `bind-component` の子スコープが宣言した「リスト」を、値の正本を持つ
 * 親スコープ側へ伝えるための翻訳ヘルパ
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.8）。
 *
 * 子の `for: items` が登録するのは子の state 要素の listPaths / elementPaths だけで、
 * 配列の実体を持つ親 state 要素は `rows` がリストであることを知らないままだった。
 * 親が `rows` を書いたときの依存 walk は `rows → rows.*` の静的子展開を
 * listPaths で判定するため、未登録だと行ごとの listIndex に展開されず
 * 「listIndex null のワイルドカードアドレス」1 本に潰れる（誰にも届かない）。
 * `rows.*` が elementPaths に無いと、行そのものへの代入（swap イディオム）も
 * listIndex 台帳の付け替えを伴わない素の代入に落ちる。
 */

import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { IAbsolutePathInfo, IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";
import { getOuterAbsolutePathInfo } from "./MappingRule";

/**
 * 子スコープの `for:` パスに対応する親スコープのパスへ「これはリストだ」を伝える。
 * マッピング規則が無い（plain なコンポーネント / ローカル state のリスト）場合は何もしない。
 *
 * 親がさらに別コンポーネントの mapped state であれば、その親の `setPathInfo` から
 * 再びここへ入って外向きに伝播する。各段で必ず外側の state 要素へ進むので停止する。
 */
export function propagateListPathToOuterState(innerStateElement: IStateElement, innerPath: string): void {
  const outerAbsPathInfo = resolveOuterAbsolutePathInfo(innerStateElement, getPathInfo(innerPath));
  if (outerAbsPathInfo === null || outerAbsPathInfo.stateElement === innerStateElement) {
    return;
  }
  outerAbsPathInfo.stateElement.setPathInfo(outerAbsPathInfo.pathInfo.path, "for");
}

/**
 * 子スコープのリスト行パス（`items.*.name`）に対応する親スコープの絶対パス情報を返す。
 * ワイルドカードの段数が一致するときだけ返す ＝ listIndex をそのまま流用できる形
 * （listIndex 台帳 `listIndexesByList` は配列オブジェクトの同一性で引かれるため、
 * 親子は同じ `IListIndex` インスタンスを共有している）。
 *
 * 段数が変わるのは、コンポーネント自身が親スコープの `for` の中にいて、さらに子でも
 * `for` を回している入れ子形。親スコープ側の行 listIndex と子スコープ側の行 listIndex は
 * 親子チェーンが繋がっていない別物なので合成できない。この形は対象外（null）。
 */
export function getOuterRowPathInfo(
  innerStateElement: IStateElement,
  innerPathInfo: IPathInfo,
): IAbsolutePathInfo | null {
  if (innerPathInfo.wildcardCount === 0) {
    return null;
  }
  const outerAbsPathInfo = resolveOuterAbsolutePathInfo(innerStateElement, innerPathInfo);
  if (outerAbsPathInfo === null || outerAbsPathInfo.stateElement === innerStateElement) {
    return null;
  }
  if (outerAbsPathInfo.pathInfo.wildcardCount !== innerPathInfo.wildcardCount) {
    return null;
  }
  return outerAbsPathInfo;
}

function resolveOuterAbsolutePathInfo(
  innerStateElement: IStateElement,
  innerPathInfo: IPathInfo,
): IAbsolutePathInfo | null {
  if (innerStateElement.hasMappedComponentState !== true) {
    return null;
  }
  const component = innerStateElement.boundComponent;
  if (component == null) {
    return null;
  }
  const innerAbsPathInfo = getAbsolutePathInfo(innerStateElement, innerPathInfo);
  // 参照専用で引く。ここはバインディング登録の最中（registerAddress → setPathInfo /
  // 行の相乗り登録）から呼ばれるので、翻訳のついでに購読者登録まで走らせると
  // `session.initialize` がセッション操作の内側から再入する。
  return getOuterAbsolutePathInfo(component, innerAbsPathInfo, false);
}
