import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { setStateListBaseline } from "../list/stateListBaseline";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { ParseBindTextResult } from "../bindTextParser/types";
import { BindingSession, getOrCreateBindingSession } from "../bindings/BindingSession";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosOf, IDeferredSpreadEntry } from "../bindings/collectNodesAndBindingInfos";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { isLightDomMappedStateElement } from "../bindings/lightDomComponentScope";
import { parseCommentNode } from "../bindings/parseCommentNode";
import { componentApplyHooks } from "../core/componentApplyHooks";
import { scheduleDeferredSpreads } from "../bindings/initializeBindings";
import { setBindingsByContent } from "../bindings/bindingsByContent";
import { setBindingSessionByContent } from "../bindings/bindingSessionByContent";
import { setIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { setNodesByContent } from "../bindings/nodesByContent";
import { bindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { config } from "../config";
import { WILDCARD, INDEX_BY_INDEX_NAME } from "../define";
import { Ssr, SSR_BLOCK_START, collectComments, isBlockBoundary, isBlockStart } from "./Ssr";
import { getStateElement } from "../stateElementByName";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { hydrateSetContent, hydrateSetLastNode } from "../apply/applyChangeToFor";
import { waitForStateInitialize } from "../waitForStateInitialize";
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { setContentByNode } from "../structural/contentsByNode";
import { createContentFromNodes } from "../structural/createContent";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { createNotFilter } from "../structural/createNotFilter";
import { getFragmentNodeInfos } from "../structural/getFragmentNodeInfos";
import { optimizeFragment } from "../structural/optimizeFragment";
import { expandShorthandPaths } from "../structural/expandShorthandPaths";
import { createListIndex } from "../list/createListIndex";
import { IListIndex, ILoopContext } from "../list/types";
import { setListIndexesByList } from "../list/listIndexesByList";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IBindingInfo } from "../types";
import { VERSION } from "../version";

// ハイドレーション時にスキップするバインディングタイプ
const STRUCTURAL_TYPES = new Set(['for', 'if', 'elseif', 'else']);


interface ISsrBlock {
  type: string;       // for, if, elseif, else
  uuid: string;
  path: string;
  index: number | null; // for のみ
  nodes: Node[];       // start〜end 間のノード
  start?: Comment;     // 開始コメント（collectSsrBlocks が付ける）
}

/**
 * ブロック開始コメントの中身（`@@wcs-for-start:uuid:path:index` / `@@wcs-if-start:uuid:path`）を読む。
 * `nodes` は空で返す（collectSsrBlocks が埋める）。
 */
function parseBlockStart(data: string): ISsrBlock {
  const [, type, info] = SSR_BLOCK_START.exec(data) as RegExpExecArray;
  const [uuid, ...rest] = info.split(':');
  return type === 'for'
    ? { type, uuid, path: rest[0], index: parseInt(rest[1], 10), nodes: [] }
    // if / elseif / else のパスは `:` を含み得るので残りを繋ぐ
    : { type, uuid, path: rest.join(':'), index: null, nodes: [] };
}

/**
 * SSR ブロック境界コメントを走査して、start〜end 間のノードを収集する
 */
function collectSsrBlocks(root: Node): ISsrBlock[] {
  const blocks: ISsrBlock[] = [];
  // 先に集めてから触る（この後で兄弟を引き剥がすため）
  for (const comment of collectComments(root, isBlockStart)) {
    const block = parseBlockStart(comment.data);
    block.start = comment;
    // start と end の間のノードを収集
    const endPattern = comment.data.replace('-start:', '-end:');
    let sibling = comment.nextSibling;
    while (sibling) {
      if (sibling.nodeType === Node.COMMENT_NODE && (sibling as Comment).data === endPattern) {
        break;
      }
      block.nodes.push(sibling);
      sibling = sibling.nextSibling;
    }
    blocks.push(block);
  }

  return blocks;
}

/**
 * 別のブロックの中にある `for` のブロック（入れ子の for・`if` / `else` の中の for）を探す。
 * 見つかれば `[内側の for, それを囲むブロック]`、無ければ null。
 *
 * このハイドレーションはブロックを文書順に**平らに**集め、行ごとの文脈を 1 段しか持てない。
 * 別のブロックの中の `for` を進めると、外側のブロックが内側の行のノードとバインディングを吸収し、
 * 内側の行の listIndex は親を持たない（#258）。実際のサーバー出力では、入れ子の for は
 * `ListIndex not found` でハイドレーション全体を止め（ready が reject され、ページのどの
 * バインディングも以後の書き込みに追従しない）、if の中の for は行が書き込みに追従せず、
 * 行を足すと SSR の行を残したまま重複した。
 *
 * 境界コメントは文書順に開き・閉じるので、開いているブロックを積んで数える。
 */
function findNestedForBlock(root: Node): [ISsrBlock, ISsrBlock] | null {
  const open: ISsrBlock[] = [];
  for (const comment of collectComments(root, isBlockBoundary)) {
    if (!isBlockStart(comment.data)) {
      open.pop();
      continue;
    }
    const block = parseBlockStart(comment.data);
    // 同じ for（同じテンプレート = uuid）の行が入れ子の順に並ぶのは、サーバーが空でないリストへ
    // 行をまとめて足したときの境界コメントの順序で、入れ子の for ではない（#258）
    const outer = open.at(-1);
    if (block.type === 'for' && outer && outer.uuid !== block.uuid) {
      return [block, outer];
    }
    open.push(block);
  }
  return null;
}

/**
 * ノード列の購読ノード（`getSubscriberNodes` をノード列へ広げたもの）。列の要素**自身**も拾い、
 * Light DOM の mapped コンポーネントの内側は除く（子スコープが自分で集める — getSubscriberNodes の注記）。
 * `getSubscriberNodes` は走査の根をコンポーネントとして数えないので、根がそれならここで降りない。
 */
function getBlockSubscriberNodes(nodes: Node[]): Node[] {
  const found: Node[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (element.hasAttribute(config.bindAttributeName)) {
        found.push(element);
      }
      if (!Array.from(element.children).some(
        (child) => child.localName === config.tagNames.state && isLightDomMappedStateElement(child))) {
        found.push(...getSubscriberNodes(element));
      }
    } else if (parseCommentNode(node) !== null) {
      found.push(node);
    }
  }
  return found;
}

/**
 * live DOM ノード群（ブロックの start〜end の間）からバインディングを収集する。
 *
 * ノードは**動かさない**（#258）。以前は一時的な div へ移して `collectNodesAndBindingInfos` に掛け、
 * 元の位置に戻していた。移すとブロックの中のカスタム要素が切断・再接続され、`bind-component` の子は
 * スコープのバインディングを破棄したまま登録し直さず、親への書き込みに追従しなかった
 * （I/O ノードも切断の後始末と接続の開始をやり直していた）。
 */
function collectBindingsFromLiveNodes(
  nodes: Node[],
): { bindingInfos: IBindingInfo[], subscriberNodes: Node[], bindingSession: BindingSession, deferredSpreads: IDeferredSpreadEntry[] } {
  // 3 要素目（未定義カスタム要素への `...: path`）は呼び出し側が
  // ループ文脈を確定させてから予約する（`scheduleDeferredSpreads`）
  const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfosOf(getBlockSubscriberNodes(nodes));
  const bindingSession = new BindingSession();
  const bindingInfos = bindingSession.initialize(allBindings, {
    registerAddress: false,
    applyOnReconnect: false,
  });

  return {
    bindingInfos,
    subscriberNodes,
    bindingSession,
    deferredSpreads,
  };
}

/**
 * ブロックの中で初回値を適用するバインディングを集める（#258 X6 — hydrateBindings の注記）。
 *
 * 除くもの:
 *  - 構造バインディング（SSR が描画済み）とイベント。
 *  - コメントに乗ったバインディング。ブロックを集める時点のコメントのバインディングは構造の置き場
 *    （`<!--@@wcs-for:uuid-->`）だけで、テキストの `@@:` はこの後で `Ssr.restoreTextBindings` が戻す。
 *    テンプレートを復帰できなかった入れ子の置き場は text として解釈される（`text: uuid`）ので、
 *    構造の種別だけでは除けない。
 *  - 添字のバインディング（`$1` / `$2` …）。state に依存しないので依存辺のための適用が要らず、SSR が
 *    描いた添字のままでよい。
 * コメントのバインディングは、適用しても失敗の報告をハイドレーションのたびに増やすだけになる。
 *
 * 以前はループの深さより多いワイルドカードを持つバインディング（外側のブロックに吸収された入れ子の
 * 内側の行）も除いていた。別のブロックの中の `for` は今はハイドレーションせずに全描画へ倒すので
 * （findNestedForBlock）、ここへは来ない。
 */
/**
 * コメントに乗った**本物のテキスト束縛**の形（`<!--@@: path-->` / `<!--@@wcs-text:path-->`）。
 *
 * コメントの束縛を一律に除いていたのは、テンプレートを復帰できなかった入れ子の構造プレースホルダが
 * `text: uuid` として解釈され、適用すると `binding-path-missing` を量産するからである。それは
 * `@@wcs-for:` のような**構造のキーワード付き**コメントなので、キーワードの有無で precise に分けられる。
 * 分けないと、`{{ }}` から復元したテキスト束縛まで初回適用から落ち、`restoreTextBindings` が
 * 捨てたサーバー側のテキストが戻らない。
 */
const TEXT_BINDING_COMMENT = /^\s*@@\s*(?:wcs-text)?\s*:/;

function collectBlockBindings(out: IBindingInfo[], bindings: readonly IBindingInfo[]): void {
  for (const binding of bindings) {
    if (binding.bindingType === "event" || STRUCTURAL_TYPES.has(binding.bindingType)) {
      continue;
    }
    if (binding.node.nodeType === Node.COMMENT_NODE
      && !(binding.bindingType === "text" && TEXT_BINDING_COMMENT.test((binding.node as Comment).data))) {
      continue;
    }
    if (binding.statePathName in INDEX_BY_INDEX_NAME) {
      continue;
    }
    out.push(binding);
  }
}

/**
 * SSR ブロックの DOM ノードを Content 化し、バインディングを登録する。
 * 戻り値はブロックの中で初回値を適用するバインディング（`collectBlockBindings`）。
 */
function hydrateBlocks(root: Node, blocks: ISsrBlock[]): IBindingInfo[] {
  // for ブロックの listIndex をリストのパスごとに収集（[最初に出会った for の uuid, 行の添字順の listIndex]）
  const listIndexesByPath: Map<string, [string, IListIndex[]]> = new Map();
  const blockBindings: IBindingInfo[] = [];

  for (const block of blocks) {
    if (block.nodes.length === 0) continue;

    const content = createContentFromNodes(block.nodes);

    // Content のバインディングを収集
    const { bindingInfos, subscriberNodes, bindingSession, deferredSpreads } = collectBindingsFromLiveNodes(block.nodes);
    setBindingSessionByContent(content, bindingSession);
    setBindingsByContent(content, bindingInfos);
    setNodesByContent(content, subscriberNodes);

    const indexBindings: IBindingInfo[] = [];
    for (const binding of bindingInfos) {
      if (binding.statePathName in INDEX_BY_INDEX_NAME) {
        indexBindings.push(binding);
      }
    }
    setIndexBindingsByContent(content, indexBindings);

    if (block.type === 'for' && block.index !== null) {
      const placeholderComment = findPlaceholderComment(root, 'for', block.uuid);
      if (placeholderComment) {
        // 行（listIndex）はリストごとに 1 組。同じリストを回す `for` が 2 つあると、テンプレート
        // （uuid）ごとに鋳造した行の組を後の方が台帳ごと上書きし、先の `for` は以後の差分で自分の
        // 行を引けず（`Content not found for ListIndex`）書き込みに追従しなかった（#258 の調査で発見）
        let entry = listIndexesByPath.get(block.path);
        if (!entry) {
          entry = [block.uuid, []];
          listIndexesByPath.set(block.path, entry);
        }
        const listIndex = entry[1][block.index] ??= createListIndex(null, block.index);
        hydrateSetContent(placeholderComment, listIndex, content);
        const lastNode = block.nodes[block.nodes.length - 1];
        hydrateSetLastNode(placeholderComment, lastNode);
        setContentByNode(placeholderComment, content);

        // ループコンテキストをバインドし、バインディングをアドレスに登録
        const pathInfo = getPathInfo(block.path + '.' + WILDCARD);
        const stateAddress = createStateAddress(pathInfo, listIndex);
        // ILoopContext は IStateAddress + listIndex なので、stateAddress をそのまま使う
        bindLoopContextToContent(content, stateAddress as any);

        bindingSession.initialize(bindingInfos, {
          registerAddress: true,
          registerPathInfo: false,
          applyOnReconnect: false,
        });
        collectBlockBindings(blockBindings, bindingInfos);
        // 未定義カスタム要素への `...: path` は行のループ文脈が確定してから予約する
        scheduleDeferredSpreads(deferredSpreads, stateAddress as unknown as ILoopContext, bindingSession);
      }
    } else {
      // 行の中の if は行どうしで uuid を共有するので、文書で最初のプレースホルダではなく開始コメントの
      // 直前（サーバーはプレースホルダの直後に開始コメントを置く）から引く。文書で最初のものを引くと、どの行の
      // 枝も行 0 に付き、行 1 以降の切り替えが枝を消せず・重ね・別の行へ移した（#258）。直前に無い出力（手で
      // 整形したもの）は従来どおり文書から探す
      const previous = block.start!.previousSibling as Comment | null;
      const placeholderComment = previous?.data === placeholderData(block.type, block.uuid)
        ? previous
        : findPlaceholderComment(root, block.type, block.uuid);
      if (placeholderComment) {
        setContentByNode(placeholderComment, content);

        bindingSession.initialize(bindingInfos, {
          registerAddress: true,
          registerPathInfo: false,
          applyOnReconnect: false,
        });
        collectBlockBindings(blockBindings, bindingInfos);
        scheduleDeferredSpreads(deferredSpreads, null, bindingSession);
      }
    }
  }

  // for ブロックの listIndex を state のリスト値に紐づける（リストごとに、最初の `for` の uuid から引く）
  for (const [uuid, indexes] of listIndexesByPath.values()) {
    const placeholderComment = findPlaceholderComment(root, 'for', uuid);
    if (!placeholderComment) continue;
    // state から現在のリスト値を取得して listIndexes を設定
    const rootNode = placeholderComment.getRootNode() as Node;
    // structuralBindings はまだ登録前なので、getParseBindTextResults を直接使う
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (!fragmentInfo) continue;
    const statePathName = fragmentInfo.parseBindTextResult.statePathName;
    const stateElement = getStateElement(rootNode);
    if (!stateElement) continue;
    stateElement.createState("readonly", (state) => {
      const list = state[statePathName];
      if (Array.isArray(list)) {
        setListIndexesByList(list, indexes);
      }
    });
  }
  return blockBindings;
}

function placeholderData(type: string, uuid: string): string {
  const keywordMap: Record<string, string> = {
    'for': config.commentForPrefix,
    'if': config.commentIfPrefix,
    'elseif': config.commentElseIfPrefix,
    'else': config.commentElsePrefix,
  };
  return `@@${keywordMap[type]}:${uuid}`;
}

function findPlaceholderComment(root: Node, type: string, uuid: string): Comment | null {
  const pattern = placeholderData(type, uuid);
  return collectComments(root, (d) => d === pattern)[0] ?? null;
}

/**
 * <wcs-ssr> 内のテンプレートを fragmentInfoByUUID に復帰させる。
 */
function restoreFragments(root: Document, ssrEl: Ssr): void {
  const rootNode = root as Node;
  let lastIfParseResult: ParseBindTextResult | null = null;
  const restored: [string, HTMLTemplateElement, ParseBindTextResult][] = [];

  for (const [uuid, tpl] of ssrEl.templates) {
    const bindText = tpl.getAttribute(config.bindAttributeName) || '';
    const parseBindTextResults = parseBindTextsForElement(bindText);
    let parseBindTextResult = parseBindTextResults[0];
    const bindingType = parseBindTextResult.bindingType;

    // else: 直前の if 条件の not → 条件反転（elseif は独自条件のままでよい）
    if (bindingType === 'else' && lastIfParseResult) {
      parseBindTextResult = {
        ...lastIfParseResult,
        outFilters: [...lastIfParseResult.outFilters, createNotFilter()],
        bindingType: 'else',
      };
    }

    // if chain の追跡
    if (bindingType === 'if') {
      lastIfParseResult = parseBindTextResult;
    } else if (bindingType === 'elseif') {
      lastIfParseResult = parseBindTextResult;
    } else if (bindingType === 'else') {
      lastIfParseResult = null;
    }
    restored.push([uuid, tpl, parseBindTextResult]);
  }

  // **子を親より先に**登録する（#258）。スナップショットのテンプレートは平らで、入れ子は親の中身に
  // プレースホルダ（`<!--@@wcs-if:<uuid>-->`）として居る。親の fragment を解析する時点で子が台帳に
  // 無いと、そのプレースホルダは `text: <uuid>` と解釈されて空の Text に潰され、親から新しく作る
  // 行・枝（行の追加、初めて真になる if）から入れ子が消えていた（実 Chromium で実測。同じモジュールで
  // サーバー描画する vitest では、サーバーの登録が台帳に残っていて見えない）。並びは文書からの
  // 幅優先（Ssr の collectReachableFragments）なので子は必ず親より後ろに居る — 逆順に回せば足りる
  for (const [uuid, tpl, parseBindTextResult] of restored.reverse()) {
    const fragment = document.importNode(tpl.content, true);
    const forPath = parseBindTextResult.bindingType === "for" ? parseBindTextResult.statePathName : undefined;
    optimizeFragment(fragment);
    if (typeof forPath === "string") {
      expandShorthandPaths(fragment, forPath);
    }
    collectStructuralFragments(rootNode, fragment, forPath);

    const fragmentInfo = {
      fragment,
      parseBindTextResult,
      nodeInfos: getFragmentNodeInfos(fragment),
    };
    setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
  }
}

/**
 * SSR ハイドレーション用バインディング初期化。
 * バージョン不一致時と、別のブロックの中に `for` のブロックがあるとき（findNestedForBlock）は
 * DOM をクリーンアップして false を返す（呼び出し元で buildBindings にフォールバック）。
 */
export async function hydrateBindings(root: Document): Promise<boolean> {
  await waitForStateInitialize(root);

  // バージョン検証
  const ssrElements = root.querySelectorAll(config.tagNames.ssr);
  for (const ssrNode of ssrElements) {
    const ssrEl = ssrNode as Ssr;
    if (!ssrEl.verifyVersion()) {
      console.warn(
        `[@wcstack/state] SSR version mismatch: server="${ssrEl.version}", client="${VERSION}". Falling back to full render.`
      );
      Ssr.cleanupDom(root);
      return false;
    }
  }

  // 入れ子の for・if の中の for はハイドレーションしない（既知の制限 — findNestedForBlock）。
  // DOM に触る前に判定し、バージョン不一致と同じ経路でクライアントの全描画に倒す。
  // SSR の DOM を捨てて描き直すことになるので、バージョン不一致と同じく黙らずに知らせる
  const nested = findNestedForBlock(document.body);
  if (nested !== null) {
    const [inner, outer] = nested;
    console.warn(
      `[@wcstack/state] SSR: "for: ${inner.path}" in "${outer.type}: ${outer.path}" (known limitation). Falling back to full render.`
    );
    Ssr.cleanupDom(root);
    return false;
  }

  // <wcs-ssr> からテンプレートを fragmentInfoByUUID に復帰
  for (const ssrNode of ssrElements) {
    restoreFragments(root, ssrNode as Ssr);
  }

  // SSR テキストバインディングを @@: 形式に復元。
  // **ブロックを集める前に**行う。後回しにしていたので、`for` / `if` の中の `{{ }}` は
  // `collectBindingsFromLiveNodes` の時点でまだ `@@wcs-text-start/end` のコメント対であり、
  // 行のバインディングとして登録されなかった。そのうえで `restoreTextBindings` は start/end の
  // 間（＝サーバーが描いたテキスト）を捨てるので、**行の `{{ }}` が空になったまま二度と戻らない**
  // （`data-wcs="textContent: …"` は属性なのでこの穴に落ちない）。
  Ssr.restoreTextBindings(document.body);

  // SSR ブロック境界コメントから既存 DOM を Content 化
  const blocks = collectSsrBlocks(document.body);
  const blockBindings = hydrateBlocks(document.body, blocks);

  // ブロック境界コメント (start/end) を除去
  Ssr.removeBlockBoundaryComments(document.body);

  // <wcs-ssr> を一時除去（バインディング走査に含めない）
  const ssrParents: { el: Element, parent: Node, next: Node | null }[] = [];
  for (const el of ssrElements) {
    if (el.parentNode) {
      ssrParents.push({ el, parent: el.parentNode, next: el.nextSibling });
      el.remove();
    }
  }

  // 構造プレースホルダーコメント (@@wcs-for:uuid 等) は残す
  // → バインディング走査で拾われ、状態変化時の再レンダリングに使われる

  // ノードとバインディングを収集（hydrateBlocks で登録済みのブロックのノードは飛ばされる）。
  // ここで集めたノードのループ文脈は触らない（#258）。以前はブロックの外のノードの文脈を空に
  // 戻していたが、この時点で文脈を持つノードは hydrateBlocks が行の文脈を与えたものだけで、
  // 戻す意味は無かった。印（`data-wcs-completed`）の付かないコメントは行のものまで空に戻され、
  // for の行の中の `if` の置き場が文脈を失い、切り替えるたびに `list index is null` で失敗していた
  const [, allBindings, deferredSpreads] = collectNodesAndBindingInfos(document.body);

  // バインディングを構造系とそれ以外に分離
  const normalBindings: IBindingInfo[] = [];
  const structuralBindings: IBindingInfo[] = [];
  const bindingSession = getOrCreateBindingSession(document.body);
  const initializedBindings = bindingSession.initialize(allBindings);
  // 未定義カスタム要素への `...: path` を `whenDefined` 後の配線として予約する。
  // 通常経路（`bindings/initializeBindings.ts`）はこれを行うが、ハイドレーション経路は
  // `collectNodesAndBindingInfos` の 3 要素目を捨てていたので、SSR したページでだけ
  // spread が**永久に配線されなかった**（実測: 通常経路は whenDefined を予約、
  // ハイドレーション経路は 1 件も予約しない）
  scheduleDeferredSpreads(deferredSpreads, null, bindingSession);

  for (const binding of initializedBindings) {
    if (binding.bindingType === "event") continue;
    if (STRUCTURAL_TYPES.has(binding.bindingType)) {
      structuralBindings.push(binding);
    } else if (binding.statePathName.includes(WILDCARD)) {
      // for ブロック内のバインディング → Content のバインディングとして登録済み
      continue;
    } else {
      normalBindings.push(binding);
    }
  }

  // for バインディングの lastListValue を初期値として設定
  // （次回の状態変化時に差分計算の基準になる）
  for (const binding of structuralBindings) {
    if (binding.bindingType === 'for') {
      const absAddr = getAbsoluteStateAddressByBinding(binding);
      const rootNode = binding.replaceNode.getRootNode() as Node;
      const stateElement = getStateElement(rootNode);
      if (stateElement) {
        stateElement.createState("readonly", (state) => {
          const value = state[binding.statePathName];
          if (Array.isArray(value)) {
            setLastListValueByAbsoluteStateAddress(absAddr, value);
            // 描画の基準と同時に state 側の基準も進める（E1。applyChangeFromBindings と対称）
            setStateListBaseline(absAddr, value);
          }
        });
      }
    }
  }

  // 初回値の適用（構造バインディングは SSR 描画済みなので除く）。SSR ブロック（for の行・if の中身）の
  // 中のバインディングも適用する（#258 X6）: getter の依存辺は getter を評価したときにしか張られない
  // ので、適用しないと行の `items.*.double` は `items.*.n` を書いても一度も再評価されず、サーバーが
  // 書いたテキストのまま固まる。値は SSR と同じ state から読むのでテキストは変わらない
  applyChangeFromBindings([...normalBindings, ...blockBindings]);

  // <wcs-ssr> を元に戻す
  for (const { el, parent, next } of ssrParents) {
    parent.insertBefore(el, next);
  }

  // hydrateProps 復元。
  // 索引は **1 回だけ** 作る。props 1 件ごとに `querySelector('[data-wcs-ssr-id="…"]')` を
  // 回していたので、props に載る束縛（textContent 等）の行数に対して二次だった
  // （実測 800 / 1600 / 3200 行で 109 / 297 / 1207 ms。props が 0 件の `value` 行は線形）
  const targetBySsrId = new Map<string, Element>();
  for (const el of root.querySelectorAll('[data-wcs-ssr-id]')) {
    targetBySsrId.set(el.getAttribute('data-wcs-ssr-id') as string, el);
  }
  for (const ssrNode of root.querySelectorAll(config.tagNames.ssr)) {
    for (const [id, propMap] of Object.entries((ssrNode as Ssr).hydrateProps)) {
      const target = targetBySsrId.get(id);
      if (!target) continue;
      for (const [propName, value] of Object.entries(propMap)) {
        // `bind-component` が束ねるプロパティ（丸ごとマウント `state: items.*`）は戻さない（#258）。
        // サーバーでは行が fragment の中で作られ、子の `<wcs-state bind-component>` の宣言より先に
        // ホストの束縛が素の書き込みとして走るので、配線の値がここに載る。戻すと子の完了前に作者の
        // state オブジェクトを親の値の写しで置き換え、全キーが私有に化けて（誤った
        // `mount-own-key-shadow`）親への書き込みに追従しなくなる。宣言済みの (要素, プロパティ) に
        // 書かないのは、親スコープの適用（apply/applyChange.ts の resolveCustomElementApply）と同じ規則
        if (componentApplyHooks?.isDeclared(target, propName)) continue;
        (target as any)[propName] = value;
      }
    }
  }

  // SSR の対応付け用属性を除去する。成功経路だけ残していたので、バージョン不一致の
  // フォールバック（`Ssr.cleanupDom`）と非対称だった — ハイドレーション済みの DOM に
  // サーバー側の帳簿が残り、`[data-wcs-ssr-id]` を見る CSS / 再ハイドレーションに漏れる
  for (const el of root.querySelectorAll('[data-wcs-ssr-id]')) {
    el.removeAttribute('data-wcs-ssr-id');
  }

  return true;
}

/** @internal テスト用 */
export const __test = {
  collectSsrBlocks,
  collectBindingsFromLiveNodes,
  hydrateBlocks,
  findPlaceholderComment,
  restoreFragments,
};
