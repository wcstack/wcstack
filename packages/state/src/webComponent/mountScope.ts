import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { type BindingSession, getOrCreateBindingSession, hasInterestedSession } from "../bindings/BindingSession";
import { getLoopContextByNode, setLoopContextByNode } from "../list/loopContextByNode";
import { initializeBindings } from "../bindings/initializeBindings";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { setBindingsReadyForScope, setStateElementAlias } from "../stateElementByName";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { raiseError } from "../raiseError";
import { ParseBindTextResult } from "../bindTextParser/types";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { getMountRecordByScopeRoot, getMountRecordsForStateElement, getScopeRootByMountRecord, IMountRecord, registerMountRecord, stateElementHasMounts, translateParsedForMount } from "./mount";
import { notifyExports, registerExports, warnShadowedExports } from "./exportIndex";
import { noteHostContext } from "./overlay";

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
/**
 * スコープ根は Shadow DOM 形ならコンポーネントの shadowRoot、Light DOM 形なら
 * コンポーネント要素自身（そのサブツリーがスコープ・D7）。Light DOM は rootNode を
 * ホストと共有するのでエイリアス不要（親の名前登録がそのまま解決に使われる）。
 * ホスト側の走査からの除外は getSubscriberNodes / collectStructuralFragments の
 * Light DOM prune（§1.13 の機構）がそのまま担う。
 */
export function initializeMountScope(record: IMountRecord, scopeRoot: ShadowRoot | Element): void {
  const existing = getMountRecordByScopeRoot(scopeRoot);
  // 1 スコープ根 1 マウント（v2）: 同じコンポーネントに 2 本目の
  // `<wcs-state bind-component>`（別 stateProp）が来ても受けられない — 受けると
  // 1 本目の session を dispose した上、収集済みノードは registeredNodeSet
  // （collectNodesAndBindingInfos.ts）が弾いて再収集されず、スコープ全体が
  // 無言で死ぬ。設定ミスとして 1 本目に触れる前に loud に落とす
  if (existing !== null && existing.stateProp !== record.stateProp) {
    raiseError(
      `A mount scope is already initialized on this component for "${existing.stateProp}" — ` +
      `one <wcs-state bind-component> per component (v2). ` +
      `Merge the "${record.stateProp}" wiring into "${existing.stateProp}" or split the component.`,
    );
  }
  // 再初期化（コンポーネントが connectedCallback で shadow の innerHTML を張り直し、
  // 新しい <wcs-state> が同じ shadowRoot に入った）: 旧スコープのバインディングは
  // 捨てられた DOM を指したまま親の台帳に残りうるので session ごと破棄してから組み直す
  //（普段は session の MutationObserver が先に破棄している — これは取りこぼし保険。
  // dispose は records と deferred を空にするだけで session 自体は使い回せる）。
  // 旧 for が残した lastListValue は applyChangeToFor 側の「content 台帳が空の
  // binding は白紙から描く」ガードが吸収する
  // The nodes still in the scope are bound again by resetScopeSession — the collection below skips them.
  if (existing !== null) {
    resetScopeSession(scopeRoot);
  }
  registerMountRecord(scopeRoot, record);
  if (scopeRoot instanceof ShadowRoot) {
    setStateElementAlias(scopeRoot, record.parentStateElement);
  }
  buildMountScopeBindings(record, scopeRoot, existing !== null);
  // Register exports and alias edges once. Notify parents that evaluated before
  // registration, including on reinitialization when values may have changed.
  registerExports(record);
  warnShadowedExports(record);
  notifyExports(record);
  setBindingsReadyForScope(scopeRoot, Promise.resolve());
}

/**
 * Dispose the scope's bindings, then restart the ones whose nodes are still in the scope. A
 * re-initialization does not always bring new content: a component that renders once keeps its nodes
 * when only its `<wcs-state>` is swapped. (A component moved while its `<wcs-state>` initializes does
 * not come here: the newer connect takes the preparation over — bindComponentLifecycle.ts.) Those nodes
 * are registered already, so the collection skips them, and the dispose alone left them dead. The restart
 * is the one a reconnect does (`handleAddedNode`): the session still knows their bindings, including a
 * text binding, whose anchor is the text node that replaced the comment and which a subscriber walk would
 * not find. The bindings of a discarded DOM are not in the scope and stay disposed. A binding that fails
 * to start again is reported, not swallowed as a mutation delivery has to.
 */
function resetScopeSession(scopeRoot: ShadowRoot | Element): void {
  const session = getOrCreateBindingSession(scopeRoot);
  session.dispose();
  const restarted: IBindingInfo[] = [];
  const walker = document.createTreeWalker(scopeRoot);
  while (walker.nextNode()) {
    session.handleAddedNode(walker.currentNode, restarted, (error) => {
      console.error("[@wcstack/state] a binding failed to start again on the mount scope's re-initialization.", error);
    });
  }
  applyChangeFromBindings(restarted);
}

/**
 * A text node that holds what a binding rendered: the anchor of a `{{ }}` binding, or text inside a bound
 * element (a property binding's output, a row's). On a re-initialization on the same DOM a `{{ … }}` in it
 * is data: converting it would bind what the data says (the component's private keys included) and
 * replace the anchor of the binding that rendered it. Passed on a re-initialization only: nothing in the
 * scope is bound on a first build.
 */
function isRenderedText(textNode: Text, walkRoot: Node): boolean {
  for (let node: Node = textNode; node !== walkRoot; node = node.parentNode!) {
    if (hasInterestedSession(node)) {
      return true;
    }
  }
  return false;
}

function buildMountScopeBindings(record: IMountRecord, walkRoot: ShadowRoot | Element, again: boolean): void {
  const transform = (parsed: ParseBindTextResult, forPath?: string): ParseBindTextResult =>
    translateParsedForMount(record, parsed, forPath);
  convertMustacheToComments(walkRoot, again ? (textNode) => isRenderedText(textNode, walkRoot) : undefined);
  // スコープ直下のバインディングのループ文脈は、行 content の初期化と同じく
  // **直接エントリ**で渡す（ホスト要素の文脈＝境界ホップの解決結果）。
  // text binding は登録前に comment が replaceNode に差し替えられて切断される
  //（bindings/replaceToReplaceNode.ts）ため、DOM walk では文脈に届かない —
  // happy-dom は切断後も parentNode を残す非準拠で偶然通るが、実ブラウザでは落ちる
  const parentLoopContext = getLoopContextByNode(record.component);
  noteHostContext(record, parentLoopContext);
  // rootNode は「fragment info の setPathInfo が state element を引く場所」。
  // Shadow DOM 形はエイリアス済みの scopeRoot 自身、Light DOM 形はホストの rootNode
  const rootNode = walkRoot instanceof ShadowRoot ? walkRoot : walkRoot.getRootNode();
  collectStructuralFragments(rootNode, walkRoot, undefined, transform);
  initializeBindings(walkRoot, parentLoopContext, transform);
}

/**
 * プール再利用の再接続（行 content の再利用で、コンポーネント要素が**別の行**に
 * 付け替わった）: マウントスコープの全バインディングを現在のループ文脈の listIndex で
 * 台帳へ張り直し、最新値を適用する。v1 の `_reloadMappedPathsAfterReconnect`（派生規則
 * memo の破棄＋プライマリ粒度の $postUpdate）に対応する、単一ツリー版の 1 手。
 * swap では listIndex が行と一緒に動くので張り直しは冪等（同じ台帳に戻るだけ）。
 */
export function remountScopeBindings(record: IMountRecord, scopeRoot: ShadowRoot | Element): void {
  // 台帳の張り直し（rebindAddresses）は直接エントリ経由で新しい listIndex を読む
  const rebound = pointScopeAtHostRow(record, scopeRoot).rebindAddresses();
  // 空でも呼んで良い（ループが回らないだけ）— 分岐を持たない
  applyChangeFromBindings(rebound);
  // 別の行に付け替わった ＝ その行の公開パスの答えが変わった（X6）
  notifyExports(record);
}

/**
 * スコープ直下の直接エントリ（バインディングのノードのループ文脈）を、ホストのいまの行の文脈へ
 * 張り替える（構築時と対称）。スコープの中にマウントしたコンポーネントの行もこのエントリで決まる
 */
export function pointScopeAtHostRow(record: IMountRecord, scopeRoot: ShadowRoot | Element): BindingSession {
  const session = getOrCreateBindingSession(scopeRoot);
  const parentLoopContext = getLoopContextByNode(record.component);
  noteHostContext(record, parentLoopContext);
  session.forEachActiveBindingNode((node) => setLoopContextByNode(node, parentLoopContext));
  return session;
}

/**
 * 要素を囲むマウントスコープ（外側から順に）の直接エントリを、いまの行へ向ける。スコープの中に
 * マウントしたコンポーネントは、再接続の `$connectedCallback` の前に自分の行をここで得る — 外側の
 * `<wcs-state bind-component>` が内側より後に置かれていても（接続は木の順に届く）
 */
export function pointEnclosingScopes(node: Node): void {
  for (let root = node.parentNode; root !== null; root = root.parentNode) {
    const record = getMountRecordByScopeRoot(root);
    if (record !== null) {
      pointEnclosingScopes(record.component);
      pointScopeAtHostRow(record, root as ShadowRoot | Element);
      return;
    }
  }
}

/**
 * 行 content をその場で使い回したときの張り直し（#4）。
 *
 * 要素書き込みで行を置き換えると `for` は同じ位置の Content を新しい行に使い回す。中の
 * コンポーネント要素は DOM から外れないので、付け替えを知らせる connectedCallback が来ない —
 * マウントスコープのバインディングは前の行の listIndex に張られたままになり、子の表示がそこで
 * 固まる。プール再利用の再接続（State.connectedCallback → remountScopeBindings）と同じ
 * 張り直しを、行の活性化（= ループ文脈の付け替え）の直後に行う。
 */
export function remountScopesUnderContent(
  content: IContent,
  stateElement: IMountRecord["parentStateElement"],
): void {
  if (!stateElementHasMounts(stateElement)) {
    return;
  }
  for (const record of getMountRecordsForStateElement(stateElement)) {
    if (!isNodeInContentRange(record.component, content)) {
      continue;
    }
    const scopeRoot = getScopeRootByMountRecord(record);
    if (scopeRoot === null) {
      continue;
    }
    remountScopeBindings(record, scopeRoot as ShadowRoot | Element);
  }
}

/** content の DOM レンジ（firstNode..lastNode）の中にあるノードか */
function isNodeInContentRange(node: Node, content: IContent): boolean {
  for (let current = content.firstNode; current !== null; current = current.nextSibling) {
    if (current === node || current.contains(node)) {
      return true;
    }
    if (current === content.lastNode) {
      break;
    }
  }
  return false;
}
