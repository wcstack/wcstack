import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { getOrCreateBindingSession } from "../bindings/BindingSession";
import { initializeBindings } from "../bindings/initializeBindings";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { setBindingsReadyForScope, setStateElementAlias } from "../stateElementByName";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { ParseBindTextResult } from "../bindTextParser/types";
import { getMountRecordByScopeRoot, IMountRecord, registerMountRecord, translateParsedForMount } from "./mount";

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
  // 再初期化（コンポーネントが connectedCallback で shadow の innerHTML を張り直し、
  // 新しい <wcs-state> が同じ shadowRoot に入った）: 旧スコープのバインディングは
  // 捨てられた DOM を指したまま親の台帳に残っている。session ごと破棄してから組み直す
  // （dispose は records と deferred を空にするだけで session 自体は使い回せる）
  // 再初期化（コンポーネントが connectedCallback で shadow の innerHTML を張り直し、
  // 新しい <wcs-state> が同じ shadowRoot に入った）: 旧スコープのバインディングは
  // 捨てられた DOM を指したまま親の台帳に残りうるので session ごと破棄してから組み直す
  //（普段は session の MutationObserver が先に破棄している — これは取りこぼし保険。
  // dispose は records と deferred を空にするだけで session 自体は使い回せる）。
  // 旧 for が残した lastListValue は applyChangeToFor 側の「content 台帳が空の
  // binding は白紙から描く」ガードが吸収する
  if (getMountRecordByScopeRoot(scopeRoot) !== null) {
    getOrCreateBindingSession(scopeRoot).dispose();
  }
  registerMountRecord(scopeRoot, record);
  setStateElementAlias(scopeRoot, record.parentStateName, record.parentStateElement);
  buildMountScopeBindings(record, scopeRoot);
  setBindingsReadyForScope(scopeRoot, Promise.resolve());
}

function buildMountScopeBindings(record: IMountRecord, walkRoot: ShadowRoot): void {
  const transform = (parsed: ParseBindTextResult, forPath?: string): ParseBindTextResult =>
    translateParsedForMount(record, parsed, forPath);
  convertMustacheToComments(walkRoot);
  // rootNode は「fragment info の setPathInfo が state element を引く場所」＝
  // エイリアス済みの scopeRoot 自身（Light DOM 形は P3-7 で追加する）
  collectStructuralFragments(walkRoot, walkRoot, undefined, transform);
  initializeBindings(walkRoot, null, transform);
}

/**
 * プール再利用の再接続（行 content の再利用で、コンポーネント要素が**別の行**に
 * 付け替わった）: マウントスコープの全バインディングを現在のループ文脈の listIndex で
 * 台帳へ張り直し、最新値を適用する。v1 の `_reloadMappedPathsAfterReconnect`（派生規則
 * memo の破棄＋プライマリ粒度の $postUpdate）に対応する、単一ツリー版の 1 手。
 * swap では listIndex が行と一緒に動くので張り直しは冪等（同じ台帳に戻るだけ）。
 */
export function remountScopeBindings(record: IMountRecord, scopeRoot: ShadowRoot | Element): void {
  const session = getOrCreateBindingSession(scopeRoot);
  const rebound = session.rebindAddresses();
  // 空でも呼んで良い（ループが回らないだけ）— 分岐を持たない
  applyChangeFromBindings(rebound);
}
