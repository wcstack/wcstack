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
import { getScopeArity } from "./baseListIndex";
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
 *
 * 呼び出し側（`BindingSession.registerAddress`）は、行バインディングを**この外側パスと
 * 子スコープの listIndex の組**で親のパターン台帳に相乗りさせる。したがって成立条件は
 * 「子の listIndex が外側パスの段数をちょうど満たすこと」＝
 * `Δ + innerW === outerW`（Δ = base 深さ）。
 *
 * - コンポーネントが親の `for` の外（Δ=0）: `outerW === innerW`（§1.8）
 * - コンポーネントが親の `for` の中（Δ>0）: 子の listIndex は base を親に持つので
 *   チェーン長が Δ+innerW になり、そのまま外側パスの段数と一致する
 *   （docs/state-bind-component-nested-for-design.md）
 */
export function getOuterRowPathInfo(
  innerStateElement: IStateElement,
  innerPathInfo: IPathInfo,
): IAbsolutePathInfo | null {
  if (innerPathInfo.wildcardCount === 0) {
    return null;
  }
  return stepOuterRowPathInfo(innerStateElement, innerPathInfo);
}

/**
 * `getOuterRowPathInfo` の 2 段目以降。境界が 2 枚以上重なっている（コンポーネントの
 * shadow の中にさらに mapped な `bind-component` がある）場合、値の正本は 1 つ外では
 * なく**最も外のスコープ**にある。1 段目だけに相乗りしていると、中間スコープは
 * 素通しで自分の行バインディングを持たないため、正本スコープ起点の行フィールド
 * 書き込みを購読する者が誰もいなくなる（§1.11）。
 *
 * 1 段目が成立したときだけ呼ばれる（＝mapped な行バインディング限定）ので、
 * 通常のリストはこの walk を一切踏まない。返り値は 2 段目以降が無ければ `null` で、
 * 圧倒的多数である深さ 1 の行では配列を確保しない。
 *
 * 各段で必ず外側の state 要素へ進む（`resolveOuterAbsolutePathInfo` は
 * `boundComponent` の属するスコープを返す＝DOM 上の真の祖先）ので停止する。
 * `propagateListPathToOuterState` の外向き伝播と同じ論拠。
 */
export function getOuterRowPathInfosBeyond(
  firstOuterAbsPathInfo: IAbsolutePathInfo,
): IAbsolutePathInfo[] | null {
  let rest: IAbsolutePathInfo[] | null = null;
  let stateElement = firstOuterAbsPathInfo.stateElement;
  let pathInfo = firstOuterAbsPathInfo.pathInfo;
  for (;;) {
    const outerAbsPathInfo = stepOuterRowPathInfo(stateElement, pathInfo);
    if (outerAbsPathInfo === null) {
      return rest;
    }
    (rest ??= []).push(outerAbsPathInfo);
    stateElement = outerAbsPathInfo.stateElement;
    pathInfo = outerAbsPathInfo.pathInfo;
  }
}

/**
 * 境界 1 枚分の外向き解決。成立条件の判定を含む。
 *
 * 判定は**両側の実 arity（`getScopeArity` = パスの段数 + そのスコープの Δ）が
 * 一致すること**。相乗り登録は子の listIndex をそのまま鍵に使うので、外側スコープが
 * その arity で台帳を引けなければ意味がない。
 *
 * 境界 1 枚なら外側は Δ=0 なので、これは従来の `Δ + innerW === outerW` と同値。
 * 2 枚以上あるときに外側の Δ を数えないと、中間スコープの Δ を二重計上して
 * 成立するはずの段を落とす（§1.12）。
 */
function stepOuterRowPathInfo(
  innerStateElement: IStateElement,
  innerPathInfo: IPathInfo,
): IAbsolutePathInfo | null {
  const outerAbsPathInfo = resolveOuterAbsolutePathInfo(innerStateElement, innerPathInfo);
  if (outerAbsPathInfo === null || outerAbsPathInfo.stateElement === innerStateElement) {
    return null;
  }
  const innerArity = getScopeArity(innerStateElement, innerPathInfo);
  const outerArity = getScopeArity(outerAbsPathInfo.stateElement, outerAbsPathInfo.pathInfo);
  if (innerArity !== outerArity) {
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
