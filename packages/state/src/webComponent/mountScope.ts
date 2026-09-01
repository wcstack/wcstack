import { initializeBindings } from "../bindings/initializeBindings";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { setBindingsReadyForScope, setStateElementAlias } from "../stateElementByName";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { ParseBindTextResult } from "../bindTextParser/types";
import { IMountRecord, registerMountRecord, translateParsedForMount } from "./mount";

/**
 * webComponent/mountScope.ts — マウントされたスコープの構築（Phase 2・impl-plan §3-0）。
 *
 * v1 の buildBindings（rootNode ごとの独立ツリー構築）に対応する、マウント版の 1 パス。
 * やることは 3 つだけで、以後このスコープのバインディングは「親スコープにインラインで
 * 書かれたもの」と完全に同じ経路（台帳・依存グラフ・updater・for/プール）を流れる。
 *
 * 1. マウント記録の登録（ループ文脈の境界ホップとオーバーレイ dispatch が引く）
 * 2. 台帳エイリアス（Shadow DOM 形のみ）: 子 rootNode → 親 state element。
 *    `getRootNode()` で解決する全サイトがこれで親ツリーに到達する
 * 3. 変換付きの収集: mustache 変換 → 構造フラグメント収集 → バインディング初期化。
 *    パース結果は translateParsedForMount で親ツリーの絶対パスに書き換わる
 *    （フラグメントは登録時に変換されるので、行の実体化は無改造・無コスト）
 *
 * 呼び手（State._initializeBindWebComponent の v2 経路）は、この完了を
 * `setBindingsReadyForScope` で子 rootNode の ready として公開する。
 */
export function initializeMountScope(record: IMountRecord, scopeRoot: ShadowRoot): void {
  registerMountRecord(scopeRoot, record);
  setStateElementAlias(scopeRoot, record.parentStateName, record.parentStateElement);
  buildMountScopeBindings(record, scopeRoot);
  setBindingsReadyForScope(scopeRoot, Promise.resolve());
}

/**
 * Light DOM 形: スコープ根はコンポーネント要素自身。rootNode はホストと共有なので
 * エイリアスは不要（親の名前登録がそのまま解決に使われる）。ホスト側の走査からの
 * 除外は getSubscriberNodes / collectStructuralFragments が担う（P2 の切替時）。
 */
export function initializeLightDomMountScope(record: IMountRecord, componentElement: Element): void {
  registerMountRecord(componentElement, record);
  buildMountScopeBindings(record, componentElement);
}

function buildMountScopeBindings(record: IMountRecord, walkRoot: ShadowRoot | Element): void {
  const transform = (parsed: ParseBindTextResult): ParseBindTextResult => translateParsedForMount(record, parsed);
  convertMustacheToComments(walkRoot);
  // rootNode は「fragment info の setPathInfo が state element を引く場所」。
  // Shadow DOM 形はエイリアス済みの scopeRoot 自身、Light DOM 形はホストの rootNode
  const rootNode = walkRoot instanceof ShadowRoot ? walkRoot : walkRoot.getRootNode();
  collectStructuralFragments(rootNode, walkRoot, undefined, transform);
  initializeBindings(walkRoot, null, transform);
}
