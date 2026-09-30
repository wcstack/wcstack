import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { setStateListBaseline } from "../list/stateListBaseline";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { ParseBindTextResult } from "../bindTextParser/types";
import { BindingSession, getOrCreateBindingSession } from "../bindings/BindingSession";
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosOf, IDeferredSpreadEntry, markNodeRegistered } from "../bindings/collectNodesAndBindingInfos";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { findNestedLightDomComponents, isLightDomMappedStateElement } from "../bindings/lightDomComponentScope";
import { parseCommentNode } from "../bindings/parseCommentNode";
import { componentApplyHooks } from "../core/componentApplyHooks";
import { scheduleDeferredSpreads } from "../bindings/initializeBindings";
import { setBindingsByContent } from "../bindings/bindingsByContent";
import { setBindingSessionByContent } from "../bindings/bindingSessionByContent";
import { setIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { setNodesByContent } from "../bindings/nodesByContent";
import { bindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { config } from "../config";
import { WILDCARD } from "../define";
import { Ssr, SSR_BLOCK_START, collectComments, isBlockBoundary, isBlockStart, isPlaceholder } from "./Ssr";
import { getStateElement } from "../stateElementByName";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { hydrateSetContent, hydrateSetLastNode, hydrateSetRenderedList } from "../apply/applyChangeToFor";
import { waitForStateInitialize } from "../waitForStateInitialize";
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { getFilteredValue } from "../apply/getFilteredValue";
import { planFilters } from "../bindings/planFilters";
import { setContentByNode } from "../structural/contentsByNode";
import { ALL_INDEX_BITS, createContentFromNodes, isIndexBinding } from "../structural/createContent";
import { IContent } from "../structural/types";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { createNotFilter } from "../structural/createNotFilter";
import { getFragmentNodeInfos } from "../structural/getFragmentNodeInfos";
import { optimizeFragment } from "../structural/optimizeFragment";
import { expandShorthandPaths } from "../structural/expandShorthandPaths";
import { createListIndex } from "../list/createListIndex";
import { IListIndex, ILoopContext } from "../list/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
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
  subscribers?: Node[]; // このブロックが自分で持つ購読ノード（hydrateBlocks が付ける）
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
    // 行をまとめて足したときの境界コメントの順序で、入れ子の for ではない（#258）。今のサーバーはこの順に
    // 並べない（#334）が、同じ minor の修正前のサーバーの出力はバージョン検証を通るので残す
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
 * live DOM の購読ノード（ブロックが自分で持つもの — hydrateBlocks）からバインディングを収集する。
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
  const [subscriberNodes, allBindings, deferredSpreads] = collectNodesAndBindingInfosOf(nodes);
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
 * コメントのバインディングは、適用しても失敗の報告をハイドレーションのたびに増やすだけになる。
 *
 * 添字のバインディング（`$1` / `$2` …）は除かない（#350）。state に依存しないので依存辺のためには
 * 要らないが、`{{ $1 }}` のサーバーのテキストは `Ssr.restoreTextBindings` が捨てているので、適用しないと
 * 行の添字が変わるまで空のままだった。以前除いていたのは、入れ子の for の内側の `$2` が外側のループ文脈
 * しか持たず読めなかったからで、別のブロックの中の `for` は今はハイドレーションしない（findNestedForBlock）。
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
    out.push(binding);
  }
}

/**
 * ブロックが**自分で**持つトップレベルのノード（#347 / #349）。CSR の Content が持つのはテンプレートの
 * トップレベルのノードだけで、入れ子の `if:`（行の直下・要素で包まない枝の中）の枝は置き場の後ろに
 * 自分の Content として描かれる。ブロックの `nodes` は入れ子のブロックの境界と中身も含むので、それを飛ばす。
 * 含めていたので、外した境界コメントが行の終わりになって末尾に足した行が文書に入らず、行を動かすと
 * 外した境界が文書に戻った。
 */
function collectOwnNodes(block: ISsrBlock, blockByStart: Map<Node | undefined, ISsrBlock>): Node[] {
  const own: Node[] = [];
  for (let i = 0; i < block.nodes.length; i++) {
    const nested = blockByStart.get(block.nodes[i]);
    if (nested) {
      // 開始コメント・中身・終了コメント
      i += nested.nodes.length + 1;
    } else {
      own.push(block.nodes[i]);
    }
  }
  return own;
}

/**
 * ブロックの中の未定義カスタム要素への `...: path`（#330）を、CSR の行（createContent → activateContent）と
 * 同じくブロックの Content の待ちとして予約する（#358）。
 *
 * - 展開した束縛はブロックの束縛の列（と添字の列）に足す。足さないと行をプールから使い回しても当て直されず、
 *   消した行の値を出し続けた。
 * - `content.spreads` に持たせる。定義前に使い回した行・開き直した枝は活性化が予約し直す。
 * - ノードを登録済みにする。しないとこの後の body 全体の走査が同じノードをもう一度拾い、ループ文脈なしの
 *   2 つ目の展開を予約した。後から発火した方が行のノードの文脈を空にし、要素の出力の書き戻し
 *   （`items.*.status`）が `ListIndex not found` で失敗した。
 */
function scheduleBlockSpreads(
  content: IContent,
  deferredSpreads: IDeferredSpreadEntry[],
  loopContext: ILoopContext | null,
  session: BindingSession,
  bindings: IBindingInfo[],
  indexBindings: IBindingInfo[],
): void {
  if (deferredSpreads.length > 0) content.spreads = deferredSpreads;
  for (const entry of deferredSpreads) markNodeRegistered(entry.node);
  scheduleDeferredSpreads(deferredSpreads, loopContext, session, bindings, indexBindings);
}

/**
 * SSR ブロックの DOM ノードを Content 化し、バインディングを登録する。
 * 戻り値はブロックの中で初回値を適用するバインディング（`collectBlockBindings`）。
 * `rowsByUuid` には for の行（listIndex）を `for`（uuid）ごとに行の添字順で集める。同じ配列を描く `for` は
 * 同じ組を持つ。リストの値へ紐づけるのは for のバインディングを起こした後（hydrateBindings — for のフィルタを
 * 通した値が行の並び）。
 */
function hydrateBlocks(root: Node, blocks: ISsrBlock[], rowsByUuid: Map<string, IListIndex[]> = new Map()): IBindingInfo[] {
  // 描いたリスト（for のフィルタを通した値。配列でなければパス）→ 行の組
  const rowsByList = new Map<unknown, IListIndex[]>();
  const blockBindings: IBindingInfo[] = [];
  const blockByStart = new Map(blocks.map((block) => [block.start, block]));

  // 購読ノードは**内側のブロックから**割り当てる（#349）。ブロックの `nodes` は入れ子のブロックのノードも
  // 含むので、文書順（外側が先）に集めると外側が内側の置き場の束縛まで登録し、内側の Content は束縛を
  // 持たなかった — 外すときに入れ子の枝を連鎖して外さず（Content.unmount は自分の構造の束縛を辿る）、
  // 前の枝が残って 2 つの枝が同時に出た。内側のブロックは必ず外側より文書で後ろに居る
  const claimed = new Set<Node>();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const subscribers = getBlockSubscriberNodes(blocks[i].nodes).filter((node) => !claimed.has(node));
    for (const node of subscribers) claimed.add(node);
    blocks[i].subscribers = subscribers;
  }

  for (const block of blocks) {
    const nodes = collectOwnNodes(block, blockByStart);
    // 中身が入れ子の境界だけのブロック（サーバー描画の最後に隠れた枝の残り — #356）は描かれていない
    if (nodes.length === 0) continue;
    // トップレベルに構造の置き場を持つブロックは CSR と同じく範囲モードにし、終端マーカー（ブロックの最後の
    // ノード＝入れ子の枝の後ろ）で範囲を閉じる（createContent の resolveRanged）。入れ子の枝は置き場の後ろ＝
    // 自分のノードの外に描かれるので、閉じないと差分が次の行を枝の手前へ入れ、行を動かすと枝を置き去りにする
    // （#347）。Text の data は置き場の形にならない
    const ranged = nodes.some((node) => isPlaceholder((node as Comment).data));
    if (ranged) {
      const marker = document.createComment(`wcs-row-end:${block.uuid}`);
      (block.nodes[block.nodes.length - 1] as ChildNode).after(marker);
      nodes.push(marker);
    }

    // Content のバインディングを収集
    const { bindingInfos, subscriberNodes, bindingSession, deferredSpreads } = collectBindingsFromLiveNodes(block.subscribers!);
    // トップレベルの `{{ }}` のコメントは初期化で Text に差し替わった。Content は差し替えた後のノードを
    // 持つ（CSR の行と同じ）— コメントを持っていたので、行を外す・動かすと値の Text が取り残された（#347）
    for (const binding of bindingInfos) {
      if (binding.node !== binding.replaceNode) {
        const index = nodes.indexOf(binding.node);
        if (index >= 0) nodes[index] = binding.replaceNode;
      }
    }
    const content = createContentFromNodes(nodes, ranged);
    setBindingSessionByContent(content, bindingSession);
    setBindingsByContent(content, bindingInfos);
    setNodesByContent(content, subscriberNodes);

    // 行の位置が変わったときに当て直す列（createContent と同じ振り分け — 添字の束縛と、中に添字の束縛を
    // 持つ入れ子の構造ディレクティブ。後から描いた枝の添字へ辿る入口・#360、#390）。段では絞らない — 入れ子の
    // for を持つブロックは全描画に倒す（findNestedForBlock）ので、ブロックの中の入れ子は if の枝だけ
    const indexBindings = bindingInfos.filter((binding) => isIndexBinding(binding, ALL_INDEX_BITS));
    setIndexBindingsByContent(content, indexBindings);

    if (block.type === 'for' && block.index !== null) {
      const placeholderComment = findPlaceholderComment(root, 'for', block.uuid);
      if (placeholderComment) {
        // 行（listIndex）は配列ごとに 1 組（list/listIndexesByList.ts）。同じリストを回す `for` が 2 つあると、
        // テンプレート（uuid）ごとに鋳造した行の組を後の方が台帳ごと上書きし、先の `for` は以後の差分で自分の
        // 行を引けず（`Content not found for ListIndex`）書き込みに追従しなかった（#258 の調査で発見）。
        // 別のパスでも同じ配列なら同じ組にする — 配列をそのまま返す getter の `for`（`for: items` と
        // `get visible() { return this.items; }` の `for: visible`）がパスごとに鋳造した組は、同じ配列の台帳を
        // 後の方が上書きし、先の `for` が同じ失敗をした（#351）
        let rows = rowsByUuid.get(block.uuid);
        if (!rows) {
          const list = readHydratedList(placeholderComment, block.uuid) ?? block.path;
          rows = rowsByList.get(list);
          if (!rows) {
            rowsByList.set(list, rows = []);
          }
          rowsByUuid.set(block.uuid, rows);
        }
        const listIndex = rows[block.index] ??= createListIndex(null, block.index);
        hydrateSetContent(placeholderComment, listIndex, content);
        hydrateSetLastNode(placeholderComment, content.lastNode as Node);
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
        scheduleBlockSpreads(content, deferredSpreads, stateAddress as unknown as ILoopContext, bindingSession, bindingInfos, indexBindings);
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
        // 行の中の枝は置き場（行が文脈を与えた）の行の文脈で束縛する（CSR の applyChangeToIf の活性化と同じ）。
        // 以前は行のブロックが枝の束縛まで持っていたので要らなかった
        const loopContext = getLoopContextByNode(placeholderComment);
        bindLoopContextToContent(content, loopContext);

        bindingSession.initialize(bindingInfos, {
          registerAddress: true,
          registerPathInfo: false,
          applyOnReconnect: false,
        });
        collectBlockBindings(blockBindings, bindingInfos);
        scheduleBlockSpreads(content, deferredSpreads, loopContext, bindingSession, bindingInfos, indexBindings);
      }
    }
  }

  return blockBindings;
}

/**
 * `for` のブロックが描いたリスト — state のいまの値に for のフィルタを通したもの（配列でなければ null）。
 * structuralBindings はまだ登録前なので、復帰したテンプレートの解析結果からパスとフィルタを引く。
 */
function readHydratedList(placeholderComment: Comment, uuid: string): unknown[] | null {
  const fragmentInfo = getFragmentInfoByUUID(uuid);
  const stateElement = getStateElement(placeholderComment.getRootNode() as Node);
  let list: unknown[] | null = null;
  if (fragmentInfo && stateElement) {
    const { statePathName, outFilters } = fragmentInfo.parseBindTextResult;
    stateElement.createState("readonly", (state) => {
      const value = getFilteredValue(state[statePathName], planFilters(outFilters, "output"));
      if (Array.isArray(value)) {
        list = value;
      }
    });
  }
  return list;
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
  const templates = ssrEl.templates;
  // else は**同じ階層**（同じテンプレートの中身か、文書の直下）で直前の if / elseif の否定（#336）。
  // クライアントの collectStructuralFragments と同じ組み方で、階層は置き場を中身に持つテンプレートで分かる。
  // スナップショットの並び（collectReachableFragments）は描いた文書の文書順なので、外側の枝が描かれて
  // いると内側の置き場が外側の else より前に並ぶ — 並びの直前と組むと、外側の else が内側の if と組んだ
  // （内側に else があると、外側の else は否定の相手を失った）。各階層の中の並びは中身の順のまま
  const levelByUuid = new Map<string, unknown>();
  for (const [uuid, tpl] of templates) {
    for (const placeholder of collectComments(tpl.content, isPlaceholder)) {
      levelByUuid.set(placeholder.data.slice(placeholder.data.indexOf(':') + 1), uuid);
    }
  }
  // Light DOM の `bind-component` の子のテンプレートは、ページの走査が子を外す（collectStructuralFragments）
  // ので、どのテンプレートの中身にも置き場が無い（中身には `<template>` のまま居る）。子は自分のスコープで
  // 組むので、階層は生きている DOM の置き場を囲む一番内側の子。文書の直下とみなすと、ページの else が
  // 子の if と組んだ（#348）。子の居ないページ（大半）は文書をもう一度走査しない
  const components = new Set<Node>(findNestedLightDomComponents(root));
  if (components.size > 0) {
    for (const placeholder of collectComments(rootNode, isPlaceholder)) {
      const uuid = placeholder.data.slice(placeholder.data.indexOf(':') + 1);
      let level = placeholder.parentNode;
      while (level !== null && !components.has(level)) level = level.parentNode;
      if (level !== null && !levelByUuid.has(uuid)) levelByUuid.set(uuid, level);
    }
  }
  // 階層（文書の直下は undefined）ごとの直前の if / elseif
  const lastIfByLevel = new Map<unknown, ParseBindTextResult | null>();
  const restored: [string, HTMLTemplateElement, ParseBindTextResult][] = [];

  for (const [uuid, tpl] of templates) {
    const bindText = tpl.getAttribute(config.bindAttributeName) || '';
    const parseBindTextResults = parseBindTextsForElement(bindText);
    let parseBindTextResult = parseBindTextResults[0];
    const bindingType = parseBindTextResult.bindingType;
    const level = levelByUuid.get(uuid);
    const lastIfParseResult = lastIfByLevel.get(level);

    // else: 直前の if 条件の not → 条件反転（elseif は独自条件のままでよい）
    if (bindingType === 'else' && lastIfParseResult) {
      parseBindTextResult = {
        ...lastIfParseResult,
        outFilters: [...lastIfParseResult.outFilters, createNotFilter()],
        bindingType: 'else',
      };
    }

    // if chain の追跡
    if (bindingType === 'if' || bindingType === 'elseif') {
      lastIfByLevel.set(level, parseBindTextResult);
    } else if (bindingType === 'else') {
      lastIfByLevel.set(level, null);
    }
    restored.push([uuid, tpl, parseBindTextResult]);
  }

  // **子を親より先に**登録する（#258）。スナップショットのテンプレートは平らで、入れ子は親の中身に
  // プレースホルダ（`<!--@@wcs-if:<uuid>-->`）として居る。親の fragment を解析する時点で子が台帳に
  // 無いと、そのプレースホルダは `text: <uuid>` と解釈されて空の Text に潰され、親から新しく作る
  // 行・枝（行の追加、初めて真になる if）から入れ子が消えていた（実 Chromium で実測。同じモジュールで
  // サーバー描画する vitest では、サーバーの登録が台帳に残っていて見えない）。並び（Ssr の
  // collectReachableFragments）では、子の置き場は親の置き場より後ろ（描いた親の枝の中）か親の中身でしか
  // 見つからないので、子は必ず親より後ろに居る — 逆順に回せば足りる
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
  const rowsByUuid: Map<string, IListIndex[]> = new Map();
  const blockBindings = hydrateBlocks(document.body, blocks, rowsByUuid);

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
          // 描いた行の並びは for のフィルタ（`for: items|…`）を通した値 — CSR の applyChangeToFor が受け取り、
          // 基準に記録する値と同じ。素の値で組んでいたので、行を減らす・並べ替えるフィルタでは台帳の行が
          // 値の要素より少なく、次の書き込みの差分が投げた
          const value = getFilteredValue(state[binding.statePathName], binding.outFilters);
          if (Array.isArray(value)) {
            // 行（listIndex）は配列ごとに 1 組。同じ配列を描く for は同じ行を紐づける（#258・#351 — hydrateBlocks）
            const rows = rowsByUuid.get(binding.uuid as string);
            if (rows) setListIndexesByList(value, rows);
            setLastListValueByAbsoluteStateAddress(absAddr, value);
            // サーバーが描いた並びを、この for が描いた並びとして記録する（クライアントで描いた for と同じく、
            // 要素の書き込みが描画の基準を書き込む前の写しへ移せるように — #351）
            hydrateSetRenderedList(binding.node, value);
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
