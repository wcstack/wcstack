import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { bindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { markObserverSkipRemovedChildren } from "../bindings/observerSkip";
import { getIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { inSsr, ssrBlockRemoval } from "../config";
import { INDEX_BY_INDEX_NAME, WILDCARD } from "../define";
import { calcDiffIndexes, createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { getLastListValueByAbsoluteStateAddress, getRenderedList, IRenderedList } from "../list/lastListValueByAbsoluteStateAddress";
import { getListIndexesByList, isRetiredListIndex } from "../list/listIndexesByList";
import { computeStableIndexSet } from "../list/stableListOrder";
import { isSwapBaselineList } from "../list/swapBaselineList";
import { IListDiff, IListIndex } from "../list/types";
import { raiseError } from "../raiseError";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { deleteContentByNode, getContentSetByNode } from "../structural/contentsByNode";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { setRootNodeByFragment } from "./rootNodeByFragment";
import { IApplyContext } from "./types";
import { applyTransitionName, getAutoNaming } from "./viewTransitionNaming";

const lastNodeByNode: WeakMap<Node, Node> = new WeakMap();
const contentByListIndexByNode: WeakMap<Node, WeakMap<IListIndex, IContent>> = new WeakMap();
const pooledContentsByNode: WeakMap<Node, IContent[]> = new WeakMap();
const isOnlyNodeInParentContentByNode: WeakMap<Node, boolean> = new WeakMap();
// この for（アンカー）が最後に描いた並び（#320。lastListValueByAbsoluteStateAddress.ts の IRenderedList）
const renderedListByNode: WeakMap<Node, IRenderedList> = new WeakMap();
// SSR 描画中の行の境界コメント [`@@wcs-for-start`, `@@wcs-for-end`]（#334）
const ssrBoundsByContent: WeakMap<IContent, Comment[]> = new WeakMap();

/**
 * SSR 描画中: 行を境界コメントで挟んで `parent` の `prev` の直後（null なら末尾）に置き、終端コメントを返す
 * （次の行はその後ろ）。境界は行の Content の範囲の外なので、Content だけを動かすと境界が置き去りになる
 * （#334 — 描いてある行の中身が自分の境界の前へ出て、足した行の境界が入れ子になった）。描いてある行は
 * 境界ごと（中の if / for が描いたノードも含めて）動かす。ラベルの添字は今の位置に付け直す（ハイドレーション
 * は添字で行を組む）。
 */
function placeSsrRow(content: IContent, parent: Node, prev: Node | null, label: string): Comment {
  let bounds = ssrBoundsByContent.get(content);
  if (typeof bounds === 'undefined') {
    bounds = [document.createComment(''), document.createComment('')];
    ssrBoundsByContent.set(content, bounds);
  }
  const [start, end] = bounds;
  start.data = `@@wcs-for-start:${label}`;
  end.data = `@@wcs-for-end:${label}`;
  if (!content.mounted) {
    // 祖先の unmount（if の非表示）で外れた行は、中身だけが外れて境界が残る。外してから置き直す
    start.remove();
    end.remove();
  }
  const ref = prev === null ? null : prev.nextSibling;
  if (start.parentNode === null) {
    // 新しい行・プールから戻す行・祖先の unmount で外れた行・その場で使い回す行（外すときに境界を外した）:
    // 境界を置いてから中身を挟む（中の if / for は、この後の活性化が境界の内側へ描く）
    parent.insertBefore(start, ref);
    parent.insertBefore(end, ref);
    content.mountAfter(start);
  } else if (ref !== start) {
    let node: Node = start;
    while (node !== end) {
      const next = node.nextSibling as Node;
      parent.insertBefore(node, ref);
      node = next;
    }
    parent.insertBefore(end, ref);
  }
  return end;
}

// テスト用ヘルパー（内部状態の操作）
export function __test_setContentByListIndex(node: Node, index: IListIndex, content: IContent | null): void {
  setContent(node, index, content);
}

export function __test_deleteLastNodeByNode(node: Node): void {
  lastNodeByNode.delete(node);
}

// SSR ハイドレーション用: Content を ListIndex に登録する
export function hydrateSetContent(node: Node, index: IListIndex, content: IContent): void {
  setContent(node, index, content);
}

export function hydrateSetLastNode(node: Node, lastNode: Node): void {
  lastNodeByNode.set(node, lastNode);
}

// SSR ハイドレーション用: サーバーが描いた並びを、この for が描いた並びとして記録する（クライアントで描いた
// for と同じく、要素の書き込みが描画の基準を書き込む前の写しへ移せるように — #351）
export function hydrateSetRenderedList(node: Node, list: readonly unknown[]): void {
  renderedListByNode.set(node, getRenderedList(list));
}

export function __test_deleteContentByNode(node: Node): void {
  contentByListIndexByNode.delete(node);
}

function getPooledContents(bindingInfo: IBindingInfo): IContent[] {
  return pooledContentsByNode.get(bindingInfo.node) || [];
}

// プールの上限（アンカーごと）。プールはアンカー（文書に永続するコメントノード）
// から content とその DOM サブツリー・バインディング群を強参照するため、無制限だと
// 大きなリストのクリア後もメモリが解放されない（10k 行で 10MB 級）。上限超過分は
// contentSetByNode の台帳からも外して GC 可能にする。再追加時は createContent で
// 作り直すコストと引き換えになる。
const MAX_POOLED_CONTENTS = 1000;
let maxPooledContents = MAX_POOLED_CONTENTS;

// テスト用: プール上限の変更と現在のプールサイズ取得
export function __test_setMaxPooledContents(limit: number): number {
  const prev = maxPooledContents;
  maxPooledContents = limit;
  return prev;
}

export function __test_getPooledContentsCount(node: Node): number {
  return (pooledContentsByNode.get(node) || []).length;
}

function setPooledContent(bindingInfo: IBindingInfo, content: IContent): void {
  let contents = pooledContentsByNode.get(bindingInfo.node);
  if (typeof contents === 'undefined') {
    contents = [];
    pooledContentsByNode.set(bindingInfo.node, contents);
  }
  if (contents.length < maxPooledContents) {
    contents.push(content);
  } else {
    // 上限超過: content を完全に手放す。contentSetByNode は createContent 時に
    // 追加されたきり解放経路が無いため、ここで外さないと GC できない。
    deleteContentByNode(bindingInfo.node, content);
  }
}

/**
 * 親の中身を一括で捨てて良いか（全行削除の近道）の判定に数えるノードか。要素・空白でないテキストの
 * ほかに、**構造ディレクティブのアンカー（コメント）** も数える（#4）。数えないと、同じ親に居る `if` の
 * アンカーまで textContent='' で消え、その `if` は以後何も描けない — 行の中が `if` だけの形では、
 * 行の器ごと壊れる（行を描き直さない main では表に出ないが、消えているのは同じ）。
 */
function countsAsParentContent(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return true;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent?.trim() ?? '') !== '';
  }
  return node.nodeType === Node.COMMENT_NODE && (node as Comment).data.startsWith('@@wcs-');
}

function isOnlyNodeInParentContent(firstNode: Node, lastNode: Node): boolean {
  let prevCheckNode = firstNode.previousSibling;
  let nextCheckNode = lastNode.nextSibling;
  let onlyNode = true;
  while(prevCheckNode !== null) {
    if (countsAsParentContent(prevCheckNode)) {
      onlyNode = false;
      break;
    }
    prevCheckNode = prevCheckNode.previousSibling;
  }
  while(nextCheckNode !== null) {
    if (countsAsParentContent(nextCheckNode)) {
      onlyNode = false;
      break;
    }
    nextCheckNode = nextCheckNode.nextSibling;
  }
  return onlyNode;
}

// A stable content may be left in place only when its first node verifiably
// follows the settled walk position in the same tree: the listIndexes ledger
// can lag the physical DOM (element-write swaps reorder listIndexes without
// moving nodes; hidden regions unmount contents that stay registered). Empty
// contents (null firstNode) always take the settle walk so their mount
// bookkeeping matches the pre-LIS behavior.
function isPhysicallyAfter(lastNode: Node, firstNode: Node | null): boolean {
  if (firstNode === null) {
    return false;
  }
  if (lastNode.nextSibling === firstNode) {
    return true;
  }
  const position = lastNode.compareDocumentPosition(firstNode);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    && (position & Node.DOCUMENT_POSITION_DISCONNECTED) === 0;
}

interface IInPlaceContents {
  /** 入る行の listIndex → その場で使い回す Content */
  readonly byAddedIndex: Map<IListIndex, IContent>;
  readonly reused: Set<IContent>;
}

/**
 * 要素書き込みの入れ替えを描き直す差分（基準が「書き込む前の並びの写し」— swapBaselineList.ts）で、
 * 同じ位置の「外す行」と「入る行」を組にし、外す行の Content を入る行にその場で使い回す（#4）。
 * 行の置き換え（リストに無かった値の書き込み）はその位置の行が新しい行に替わるだけなので、プールを通して
 * ブロックを DOM から外す必要が無い — 外すと、双方向バインドの入力で打鍵ごとにフォーカスが失われる。
 * 配列の置換の差分は対象にしない（外した行の Content はこれまでどおりプールを通す）。
 */
function collectInPlaceContents(
  contentMap: WeakMap<IListIndex, IContent>,
  lastValue: unknown,
  diff: IListDiff,
): IInPlaceContents | null {
  if (!isSwapBaselineList(lastValue)) {
    return null;
  }
  let inPlace: IInPlaceContents | null = null;
  for (let position = 0; position < diff.newIndexes.length; position++) {
    const added = diff.newIndexes[position];
    const removed = diff.oldIndexes[position];
    const content = diff.addIndexSet.has(added) && diff.deleteIndexSet.has(removed)
      ? contentMap.get(removed)
      : undefined;
    if (typeof content === "undefined") {
      continue;
    }
    inPlace ??= { byAddedIndex: new Map(), reused: new Set() };
    inPlace.byAddedIndex.set(added, content);
    inPlace.reused.add(content);
  }
  return inPlace;
}

const STRUCTURAL_BINDING_TYPES = new Set(['if', 'elseif', 'else', 'for']);

/**
 * 使い回す Content の「適用済み」の印を落とす。入れ子の構造ディレクティブが持つ Content も辿る —
 * `if` の中の `for` や、`elseif` / `else` のアンカーは行の Content ではなく**内側の** Content に
 * 属するので、行の binding だけ落としても新しい行として適用し直されない（印が残ったまま
 * activateContent の applyChange に飛ばされ、解体した内側が描き直されないまま空になる）。
 */
function clearAppliedMarks(content: IContent, context: IApplyContext): void {
  for (const binding of getBindingsByContent(content)) {
    context.appliedBindingSet.delete(binding);
    if (!STRUCTURAL_BINDING_TYPES.has(binding.bindingType)) {
      continue;
    }
    for (const nested of getContentSetByNode(binding.node)) {
      clearAppliedMarks(nested, context);
    }
  }
}

/**
 * 位置が変わった行の添字の束縛（`$1` …）を当て直す。行の中の入れ子の構造ディレクティブ（createContent が
 * 同じ列に入れる）の Content — 内側の for の行・if の枝、その奥 — も辿る（#360）。内側の for は同じ配列を
 * 描き続けるので差分が出ず、if は条件が変わらないので、ここで辿らないと外側の軸の添字が古いまま残る。
 * 添字を条件に持つ構造ディレクティブ（`if: $1|lt(2)`）は当て直してから辿る（真のままなら枝は描き直されない）。
 * 外れている Content（プールの行・偽の if の枝）は辿らない（戻すときの活性化が全部の束縛を当てる）。
 */
function applyIndexBindings(content: IContent, context: IApplyContext): void {
  for (const binding of getIndexBindingsByContent(content)) {
    if (!STRUCTURAL_BINDING_TYPES.has(binding.bindingType)) {
      applyChange(binding, context);
      continue;
    }
    if (binding.statePathName in INDEX_BY_INDEX_NAME) {
      applyChange(binding, context);
    }
    for (const nested of getContentSetByNode(binding.node)) {
      if (nested.mounted) {
        applyIndexBindings(nested, context);
      }
    }
  }
}

/**
 * 入れ子の `for` が持つ Content を解体して台帳から外す（#4）。その場で使い回す行の中身は新しい行として
 * 作り直されるので、外した Content をアンカーの content 台帳（contentSetByNode）に残すと、置き換えの
 * たびに伸び続ける。プールへ返さないのは、返すと次の適用で内側の `for` が「全行削除」の近道
 * （親の textContent を空にする）に入り、囲む `if` のアンカーごと行を壊すため。`if` の Content は
 * アンカーごとに 1 つを使い回すので外さない。
 */
function dropNestedContents(content: IContent): void {
  for (const binding of getBindingsByContent(content)) {
    if (!STRUCTURAL_BINDING_TYPES.has(binding.bindingType)) {
      continue;
    }
    const dropped = binding.bindingType === 'for';
    for (const nested of getContentSetByNode(binding.node)) {
      dropNestedContents(nested);
      if (!dropped || !nested.mounted) {
        continue;
      }
      deactivateContent(nested);
      nested.unmount();
      deleteContentByNode(binding.node, nested);
      // 描いた行を捨てたので、その for が描いた並びも捨てて白紙から描かせる（#320。残すと次の適用が、
      // 捨てた行を自分の行として差分の旧側に数え、台帳から外した Content をプールへ戻してしまう）
      renderedListByNode.delete(binding.node);
    }
  }
}

function setContent(node: Node, listIndex: IListIndex, content: IContent | null): void {
  let contentByListIndex = contentByListIndexByNode.get(node);
  if (typeof contentByListIndex === 'undefined') {
    if (content === null) {
      return;
    }
    contentByListIndex = new WeakMap<IListIndex, IContent>();
    contentByListIndexByNode.set(node, contentByListIndex);
  }
  if (content === null) {
    contentByListIndex.delete(listIndex);
  } else {
    contentByListIndex.set(listIndex, content);
  }
}

export function applyChangeToFor(
  bindingInfo: IBindingInfo, 
  context: IApplyContext,
  newValue: unknown, 
): void {
  const listPathInfo = bindingInfo.statePathInfo;
  const listIndex = getListIndexByBindingInfo(bindingInfo);
  const absAddress = getAbsoluteStateAddressByBinding(bindingInfo);
  const recordedLastValue = getLastListValueByAbsoluteStateAddress(absAddress);
  const rendered = renderedListByNode.get(bindingInfo.node);
  let lastValue: readonly unknown[];
  let diff: IListDiff;
  // 共有の記録が、この for の描いた並びを置いて進んだ（#320）。同じリストを描く別の for だけが描いた —
  // この for は `if` で消されていた・DOM から外されていた — か、行の Content の使い回しでこの for が
  // 別の行に付け替わった。行の台帳（どの値がどの行か）は共有の差分で進め、描き替えは自分が描いた行と
  // 今の行を行の同一性で突き合わせて決める。描いた並びが空なら台帳は無い（全行 add）。
  // 今の行の親がこの for の行でない（要素書き込みが古い親に行を鋳造した台帳の食い違い）なら突き合わせに
  // 使わない — 別の行の値を描き、その後の書き込みを別の行へ着地させる。従来の差分に戻して、食い違いを
  // 見える失敗（Content not found）のまま残す
  const shared = typeof rendered !== 'undefined' && rendered.value !== recordedLastValue
    ? createListDiff(listIndex, recordedLastValue, newValue)
    : null;
  if (shared !== null && shared.newIndexes.every((row) => row.parentListIndex === listIndex || isRetiredListIndex(row.parentListIndex!))) {
    lastValue = rendered!.value;
    diff = calcDiffIndexes(getListIndexesByList(lastValue) ?? [], shared.newIndexes);
  } else {
    // lastListValue はアドレスキーの共有台帳。まだ何も描いていない binding ノード
    //（content 台帳が空）が、既に描画済みのアドレスに後から参加する形 — マウント
    // スコープの再初期化（コンポーネントが connectedCallback で shadow を張り直す）や
    // 後着ノードの binder 適用 — では、共有の記録で差分を取ると「既存 content の
    // 再利用・維持」を指示され、この binding には無いので落ちる。自分の台帳が空なら
    // 白紙から全行 add で描く（同じアドレスの他の binding の差分には影響しない）
    lastValue = recordedLastValue.length > 0 && !contentByListIndexByNode.has(bindingInfo.node)
      ? []
      : recordedLastValue;
    diff = createListDiff(listIndex, lastValue, newValue);
  }
  const newListValue = Array.isArray(newValue) ? newValue : [];
  context.newListValueByAbsAddress.set(absAddress, newListValue);
  renderedListByNode.set(bindingInfo.node, getRenderedList(newListValue));

  let contentMap = contentByListIndexByNode.get(bindingInfo.node);
  // 要素書き込みの入れ替えを描き直す差分では、同じ位置で外す行の Content を入る行がその場で使い回す（#4）
  const inPlaceContents = typeof contentMap !== 'undefined' ? collectInPlaceContents(contentMap, lastValue, diff) : null;
  const fullDelete = Array.isArray(lastValue)
    && lastValue.length === diff.deleteIndexSet.size
    && diff.deleteIndexSet.size > 0;
  // その場で使い回す Content があるときは、親を空にする近道を取らない（使い回す行の DOM も消える）
  if (fullDelete && inPlaceContents === null && bindingInfo.node.parentNode !== null) {
    let isOnlyNode = isOnlyNodeInParentContentByNode.get(bindingInfo.node);
    if (typeof isOnlyNode === 'undefined') {
      const lastNode = lastNodeByNode.get(bindingInfo.node) || bindingInfo.node;
      isOnlyNode = isOnlyNodeInParentContent(bindingInfo.node, lastNode);
      isOnlyNodeInParentContentByNode.set(bindingInfo.node, isOnlyNode);
    }
    if (isOnlyNode) {
      const parentNode = bindingInfo.node.parentNode;
      // 全行は 1 つの mutation record で消えるので、親に「framework の削除がこの件数」と 1 回書けば
      // observer はその record を丸ごと飛ばせる（行ごとの印を消費しない。bindings/observerSkip.ts）
      markObserverSkipRemovedChildren(parentNode, parentNode.childNodes.length);
      parentNode.textContent = '';
      parentNode.appendChild(bindingInfo.node);
    }
  }
  // 全削除時、プールに収まらない content は再利用されないため、per-binding の
  // teardown（listener 解除・アドレス台帳・loopContext 掃除）を丸ごと省略して
  // ノードごと GC に任せる（tryDestroy）。プール行きの分だけ従来どおり解体する
  // （プール行は binding が生存し続けるため address キャッシュのクリアが必須）。
  // content 台帳の WeakMap ビルトインは V8 プロファイルで本関数の self に計上される
  // ホットスポット: 外側の node→map 解決はループ外に持ち上げ、fullDelete（旧全行が
  // deleteIndexSet に載る＝台帳の全エントリが消える）では per-index delete を廃して
  // 台帳ごと 1 回で手放す。
  let poolBudget = fullDelete
    ? maxPooledContents - getPooledContents(bindingInfo).length
    : Number.POSITIVE_INFINITY;
  const ssrMode = inSsr();
  if (typeof contentMap !== 'undefined') {
    // Set の for...of は行ごとに反復子の結果オブジェクトを割り当てる（消去の scavenge の引き金）ので forEach で回す
    const map = contentMap;
    diff.deleteIndexSet.forEach((deleteIndex) => {
      const content = map.get(deleteIndex);
      if (typeof content !== 'undefined') {
        if (ssrMode) {
          // 外す行の境界も外す（#334。その場で使い回す行は、足す行として境界を置き直す）。SSR の外で
          // 描いた行（同じ文書で後から SSR が始まった）は境界を持たない
          ssrBoundsByContent.get(content)?.forEach((bound) => bound.remove());
          ssrBlockRemoval.seen = true;
        }
        if (inPlaceContents !== null && inPlaceContents.reused.has(content)) {
          // 同じ位置に入る行がその場で使い回す。自分のノードは DOM に残し、プールにも入れないが、
          // 解体は unmount と同じ（ネストした for / if の Content とアドレス台帳を落とす）
          deactivateContent(content);
          dropNestedContents(content);
          content.unmountInPlace();
        } else if (poolBudget <= 0 && content.tryDestroy()) {
          deleteContentByNode(bindingInfo.node, content);
        } else {
          deactivateContent(content);
          content.unmount();
          setPooledContent(bindingInfo, content);
          poolBudget -= 1;
        }
        if (!fullDelete) {
          map.delete(deleteIndex);
        }
      }
    });
    if (fullDelete) {
      contentByListIndexByNode.delete(bindingInfo.node);
      contentMap = undefined;
    }
  }

  let lastNode = bindingInfo.node;
  const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
  const loopContextStack = context.stateElement.loopContextStack;
  // When the new order contains inversions, contents in the stable set (an LIS
  // of old positions) keep their relative order and must not be moved; moving
  // only the rest avoids the cascade where one swap relocates every row in
  // between. null = no inversions; the position guard below then does no moves.
  const stableIndexSet = computeStableIndexSet(diff);
  let fragment: DocumentFragment | null = null;
  if (diff.newIndexes.length == diff.addIndexSet.size 
    && diff.newIndexes.length > 0
    && lastNode.isConnected
    && inPlaceContents === null
  ) {
    // 全部追加の場合はまとめて処理
    fragment = document.createDocumentFragment();
    setRootNodeByFragment(fragment, context.rootNode);
  }
  // SSR の境界コメントのラベル（`<uuid>:<path>:` ＋ 行の添字）
  const ssrLabel = ssrMode ? `${bindingInfo.uuid}:${listPathInfo.path}:` : '';
  // 自動命名ポリシーは行ごとではなく apply ごとに 1 回だけ引く
  // （docs/view-transition-design.md §6）。既定の manual では null で、
  // 以降の行ループは分岐 1 つ分しか増えない。
  const autoNaming = getAutoNaming();
  // 追加行ごとの WeakMap 解決を避けるためプール配列も 1 回だけ引く（プールの配列
  // 実体は setPooledContent が一度作ったら不変なので、delete ループ後の参照で安定）
  const pooledContents = pooledContentsByNode.get(bindingInfo.node);
  for(const index of diff.newIndexes) {
    let content: IContent | undefined;
    // add
    if (diff.addIndexSet.has(index)) {
      const stateAddress = createStateAddress(elementPathInfo, index);
      loopContextStack.createLoopContext(stateAddress, (loopContext) => {
        content = inPlaceContents?.byAddedIndex.get(index)
          ?? (typeof pooledContents !== 'undefined' ? pooledContents.pop() : undefined);
        if (typeof content === 'undefined') {
          content = createContent(bindingInfo);
        } else {
          // プール（か同じ位置）から使い回す Content の binding は、同じバッチで**外した行として**適用済みのことがある。
          // 外した行のアドレスへの書き込み（行の葉・要素の置き換え）で enqueue された binding が、この `for`
          // より先に適用された形。印が残ると activateContent の applyChange が飛ばし、新しい行に外した行の
          // 値が残る（表示と state が食い違う）。新しい行として適用し直す
          clearAppliedMarks(content, context);
          // DOM に戻す前に新しい行のループ文脈を張る。戻した瞬間に中のマウント済みコンポーネントの
          // 再接続（`$connectedCallback`）が同期で走り、要素の行を引く（#368）
          bindLoopContextToContent(content, loopContext);
        }
        // コンテント活性化の前にDOMツリーに追加しておく必要がある
        if (ssrMode) {
          lastNode = fragment !== null
            ? placeSsrRow(content, fragment, null, ssrLabel + index.index)
            : placeSsrRow(content, lastNode.parentNode!, lastNode, ssrLabel + index.index);
        } else if (fragment !== null) {
          content.appendTo(fragment);
        } else if (lastNode.nextSibling !== content.firstNode) {
          // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
          content.mountAfter(lastNode);
        }
        // コンテントを活性化
        activateContent(content, loopContext, context);
        if (autoNaming !== null) {
          applyTransitionName(content, "row", autoNaming);
        }
      });
      if (typeof content === 'undefined') {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
      if (inPlaceContents !== null && inPlaceContents.reused.has(content)) {
        // その場で使い回した行の中のコンポーネントは DOM から外れない = 付け替えを知らせる
        // connectedCallback が来ないので、マウントスコープを新しい行の listIndex へ張り直す（#4）。
        // スコープ機能の rowReused hook（webComponent/addressHooks.ts）。hook の無い state は判定 1 個で抜ける
        const hooks = context.stateElement.addressHooks;
        if (hooks) {
          const reused = hooks.rowReused;
          for (let i = 0; i < reused.length; i++) {
            reused[i](context.stateElement, content);
          }
        }
      }
    } else {
      // getContent 相当（undefined→null 正規化は後段の raiseError 判定が null 比較のため維持）
      content = (typeof contentMap !== 'undefined' ? contentMap.get(index) ?? null : null)!;
      if (diff.changeIndexSet.has(index)) {
        // change
        applyIndexBindings(content, context);
      }
      // Update lastNode for next iteration to ensure correct order
      // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
      if (content === null) {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
      // 祖先の unmount（if の非表示など）で解体された行は、ここで物理的に
      // 戻されるだけでは binding が dispose 済みのまま復活しない。位置合わせの
      // 前に判定しておき（mountAfter が mounted を立てる）、戻した後に再活性化する。
      const unmountedByAncestor = !content.mounted;
      if (ssrMode) {
        lastNode = placeSsrRow(content, lastNode.parentNode!, lastNode, ssrLabel + index.index);
      } else if (!(stableIndexSet !== null && stableIndexSet.has(index) && isPhysicallyAfter(lastNode, content.firstNode))
        && lastNode.nextSibling !== content.firstNode) {
        // Stable contents are already in correct relative order — but only
        // trust that after physical verification (see isPhysicallyAfter).
        // Contents out of order (and everything unverifiable) settle via the
        // self-healing mountAfter walk.
        content.mountAfter(lastNode);
      }
      if (unmountedByAncestor) {
        // 再活性化しないと、行の同一性が保たれる更新が以後すべて無視される
        // （docs/state-deactivated-content-stale-update.md）。activate は
        // disposed record の再構築を含むので、プール再利用と同じ経路で戻る。
        const revivedContent = content;
        const stateAddress = createStateAddress(elementPathInfo, index);
        loopContextStack.createLoopContext(stateAddress, (loopContext) => {
          activateContent(revivedContent, loopContext, context);
        });
      }
    }
    if (!ssrMode) {
      // SSR では行の終端コメント（placeSsrRow が返す）のまま
      lastNode = content.lastNode || lastNode;
    }
    if (typeof contentMap === 'undefined') {
      contentMap = new WeakMap<IListIndex, IContent>();
      contentByListIndexByNode.set(bindingInfo.node, contentMap);
    }
    contentMap.set(index, content);
  }
  lastNodeByNode.set(bindingInfo.node, lastNode);
  if (fragment !== null) {
    // Mount all at once
    bindingInfo.node.parentNode!.insertBefore(fragment, bindingInfo.node.nextSibling);
    setRootNodeByFragment(fragment, null);
  }
}
