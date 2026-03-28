import { getAbsoluteStateAddressByBinding } from "./binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress } from "./binding/getBindingSetByAbsoluteStateAddress";
import { setLastListValueByAbsoluteStateAddress } from "./list/lastListValueByAbsoluteStateAddress";
import { parseBindTextsForElement } from "./bindTextParser/parseBindTextsForElement";
import { ParseBindTextResult } from "./bindTextParser/types";
import { collectNodesAndBindingInfos } from "./bindings/collectNodesAndBindingInfos";
import { setBindingsByContent } from "./bindings/bindingsByContent";
import { setIndexBindingsByContent } from "./bindings/indexBindingsByContent";
import { setNodesByContent } from "./bindings/nodesByContent";
import { bindLoopContextToContent } from "./bindings/bindLoopContextToContent";
import { config } from "./config";
import { WILDCARD, INDEX_BY_INDEX_NAME } from "./define";
import { Ssr, SSR_BLOCK_START } from "./components/Ssr";
import { getStateElementByName } from "./stateElementByName";
import { raiseError } from "./raiseError";
import { setLoopContextByNode } from "./list/loopContextByNode";
import { replaceToReplaceNode } from "./bindings/replaceToReplaceNode";
import { attachEventHandler } from "./event/handler";
import { attachTwowayEventHandler } from "./event/twowayHandler";
import { attachRadioEventHandler } from "./event/radioHandler";
import { attachCheckboxEventHandler } from "./event/checkboxHandler";
import { applyChangeFromBindings } from "./apply/applyChangeFromBindings";
import { hydrateSetContent, hydrateSetLastNode } from "./apply/applyChangeToFor";
import { waitForStateInitialize } from "./waitForStateInitialize";
import { setFragmentInfoByUUID, getFragmentInfoByUUID } from "./structural/fragmentInfoByUUID";
import { setContentByNode } from "./structural/contentsByNode";
import { createContentFromNodes } from "./structural/createContent";
import { collectStructuralFragments } from "./structural/collectStructuralFragments";
import { createNotFilter } from "./structural/createNotFilter";
import { getFragmentNodeInfos } from "./structural/getFragmentNodeInfos";
import { optimizeFragment } from "./structural/optimizeFragment";
import { expandShorthandPaths } from "./structural/expandShorthandPaths";
import { createListIndex } from "./list/createListIndex";
import { IListIndex } from "./list/types";
import { setListIndexesByList } from "./list/listIndexesByList";
import { getPathInfo } from "./address/PathInfo";
import { createStateAddress } from "./address/StateAddress";
import { IBindingInfo } from "./types";
import { VERSION } from "./version";

// ハイドレーション時にスキップするバインディングタイプ
const STRUCTURAL_TYPES = new Set(['for', 'if', 'elseif', 'else']);


interface ISsrBlock {
  type: string;       // for, if, elseif, else
  uuid: string;
  path: string;
  index: number | null; // for のみ
  nodes: Node[];       // start〜end 間のノード
}

/**
 * SSR ブロック境界コメントを走査して、start〜end 間のノードを収集する
 */
function collectSsrBlocks(root: Node): ISsrBlock[] {
  const blocks: ISsrBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const startComments: Comment[] = [];

  // まず全コメントを収集
  while (walker.nextNode()) {
    startComments.push(walker.currentNode as Comment);
  }

  for (const comment of startComments) {
    const startMatch = SSR_BLOCK_START.exec(comment.data);
    if (!startMatch) continue;

    const type = startMatch[1];
    const info = startMatch[2]; // "uuid:path:index" or "uuid:path"
    const parts = info.split(':');

    let uuid: string;
    let path: string;
    let index: number | null = null;

    if (type === 'for') {
      // uuid:path:index
      uuid = parts[0];
      path = parts[1];
      index = parseInt(parts[2], 10);
    } else {
      // uuid:path
      uuid = parts[0];
      path = parts.slice(1).join(':');
    }

    // start と end の間のノードを収集
    const nodes: Node[] = [];
    let sibling = comment.nextSibling;
    const endPattern = `@@wcs-${type}-end:${info}`;
    while (sibling) {
      if (sibling.nodeType === Node.COMMENT_NODE && (sibling as Comment).data === endPattern) {
        break;
      }
      nodes.push(sibling);
      sibling = sibling.nextSibling;
    }

    blocks.push({ type, uuid, path, index, nodes });
  }

  return blocks;
}

/**
 * live DOM ノード群からバインディングを収集する。
 * ノードを一時的に DocumentFragment に移動して collectNodesAndBindingInfos を実行し、
 * 元の位置に戻す。
 */
function collectBindingsFromLiveNodes(
  nodes: Node[],
): { bindingInfos: IBindingInfo[], subscriberNodes: Node[] } {
  if (nodes.length === 0) return { bindingInfos: [], subscriberNodes: [] };

  // ノードの元の位置を記録
  const parent = nodes[0].parentNode;
  const nextSibling = nodes[nodes.length - 1].nextSibling;

  // 一時的に wrapper 要素に移動（collectNodesAndBindingInfos は Element を受け付ける）
  const wrapper = document.createElement('div');
  for (const node of nodes) {
    wrapper.appendChild(node);
  }

  // バインディング収集
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(wrapper);

  // _initializeBindings 相当の処理
  for (const binding of allBindings) {
    replaceToReplaceNode(binding);
    if (attachEventHandler(binding)) continue;
    attachTwowayEventHandler(binding);
    attachRadioEventHandler(binding);
    attachCheckboxEventHandler(binding);
  }

  // 元の位置に戻す
  if (parent) {
    while (wrapper.firstChild) {
      parent.insertBefore(wrapper.firstChild, nextSibling);
    }
  }

  return {
    bindingInfos: allBindings,
    subscriberNodes,
  };
}

/**
 * SSR ブロックの DOM ノードを Content 化し、バインディングを登録する。
 */
function hydrateBlocks(root: Node, blocks: ISsrBlock[]): void {
  // for ブロックの listIndex を UUID ごとに収集
  const listIndexesByUuid: Map<string, IListIndex[]> = new Map();

  for (const block of blocks) {
    if (block.nodes.length === 0) continue;

    const content = createContentFromNodes(block.nodes);

    // Content のバインディングを収集
    const { bindingInfos, subscriberNodes } = collectBindingsFromLiveNodes(block.nodes);

    // Content 内のノードに data-wcs-completed を付与
    // （メインの collectNodesAndBindingInfos で重複登録されないようにする）
    for (const node of subscriberNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        (node as Element).setAttribute('data-wcs-completed', '');
      }
    }
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
        const listIndex = createListIndex(null, block.index);
        hydrateSetContent(placeholderComment, listIndex, content);
        const lastNode = block.nodes[block.nodes.length - 1];
        hydrateSetLastNode(placeholderComment, lastNode);
        setContentByNode(placeholderComment, content);

        // ループコンテキストをバインドし、バインディングをアドレスに登録
        const pathInfo = getPathInfo(block.path + '.' + WILDCARD);
        const stateAddress = createStateAddress(pathInfo, listIndex);
        // ILoopContext は IStateAddress + listIndex なので、stateAddress をそのまま使う
        bindLoopContextToContent(content, stateAddress as any);

        for (const binding of bindingInfos) {
          const absAddr = getAbsoluteStateAddressByBinding(binding);
          addBindingByAbsoluteStateAddress(absAddr, binding);
        }

        // listIndex を UUID ごとに収集（後で setListIndexesByList に渡す）
        let indexes = listIndexesByUuid.get(block.uuid);
        if (!indexes) {
          indexes = [];
          listIndexesByUuid.set(block.uuid, indexes);
        }
        indexes.push(listIndex);
      }
    } else {
      const placeholderComment = findPlaceholderComment(root, block.type, block.uuid);
      if (placeholderComment) {
        setContentByNode(placeholderComment, content);

        // バインディングをアドレスに登録
        for (const binding of bindingInfos) {
          const absAddr = getAbsoluteStateAddressByBinding(binding);
          addBindingByAbsoluteStateAddress(absAddr, binding);
        }
      }
    }
  }

  // for ブロックの listIndex を state のリスト値に紐づける
  for (const [uuid, indexes] of listIndexesByUuid) {
    const placeholderComment = findPlaceholderComment(root, 'for', uuid);
    if (!placeholderComment) continue;
    // state から現在のリスト値を取得して listIndexes を設定
    const rootNode = placeholderComment.getRootNode() as Node;
    // structuralBindings はまだ登録前なので、getParseBindTextResults を直接使う
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (!fragmentInfo) continue;
    const stateName = fragmentInfo.parseBindTextResult.stateName;
    const statePathName = fragmentInfo.parseBindTextResult.statePathName;
    const stateElement = getStateElementByName(rootNode, stateName);
    if (!stateElement) continue;
    stateElement.createState("readonly", (state) => {
      const list = state[statePathName];
      if (Array.isArray(list)) {
        setListIndexesByList(list, indexes);
      }
    });
  }
}

function findPlaceholderComment(root: Node, type: string, uuid: string): Comment | null {
  const prefix = config as any;
  const keywordMap: Record<string, string> = {
    'for': config.commentForPrefix,
    'if': config.commentIfPrefix,
    'elseif': config.commentElseIfPrefix,
    'else': config.commentElsePrefix,
  };
  const keyword = keywordMap[type];
  if (!keyword) return null;

  const pattern = `@@${keyword}:${uuid}`;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) {
    const comment = walker.currentNode as Comment;
    if (comment.data === pattern) {
      return comment;
    }
  }
  return null;
}

/**
 * <wcs-ssr> 内のテンプレートを fragmentInfoByUUID に復帰させる。
 */
function restoreFragments(root: Document, ssrEl: Ssr): void {
  const rootNode = root as Node;
  let lastIfParseResult: ParseBindTextResult | null = null;

  for (const [uuid, tpl] of ssrEl.templates) {
    const bindText = tpl.getAttribute(config.bindAttributeName) || '';
    const parseBindTextResults = parseBindTextsForElement(bindText);
    let parseBindTextResult = parseBindTextResults[0];
    const bindingType = parseBindTextResult.bindingType;

    // else: 直前の if 条件の not → 条件反転
    // elseif: 独自条件を持つが stateName は if から引き継ぐ
    if (bindingType === 'else' && lastIfParseResult) {
      parseBindTextResult = {
        ...lastIfParseResult,
        outFilters: [...lastIfParseResult.outFilters, createNotFilter()],
        bindingType: 'else',
      };
    } else if (bindingType === 'elseif' && lastIfParseResult) {
      parseBindTextResult = {
        ...parseBindTextResult,
        stateName: lastIfParseResult.stateName,
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

    const fragment = document.importNode(tpl.content, true);
    const forPath = bindingType === "for" ? parseBindTextResult.statePathName : undefined;
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
 * バージョン不一致時は DOM をクリーンアップして false を返す
 * （呼び出し元で buildBindings にフォールバック）。
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

  // <wcs-ssr> からテンプレートを fragmentInfoByUUID に復帰
  for (const ssrNode of ssrElements) {
    restoreFragments(root, ssrNode as Ssr);
  }

  // SSR ブロック境界コメントから既存 DOM を Content 化
  const blocks = collectSsrBlocks(document.body);
  hydrateBlocks(document.body, blocks);

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

  // SSR テキストバインディングを @@: 形式に復元
  Ssr.restoreTextBindings(document.body);

  // ノードとバインディングを収集
  const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(document.body);

  // 収集完了したノードに data-wcs-completed 属性を付与
  // for ブロック内ノード（hydrateBlocks で登録済み）にはループコンテキストをリセットしない
  for (const node of subscriberNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (!el.hasAttribute('data-wcs-completed')) {
        setLoopContextByNode(node, null);
        el.setAttribute('data-wcs-completed', '');
      }
    } else {
      // コメントノード等
      setLoopContextByNode(node, null);
    }
  }

  // バインディングを構造系とそれ以外に分離
  const normalBindings: IBindingInfo[] = [];
  const structuralBindings: IBindingInfo[] = [];

  for (const binding of allBindings) {
    replaceToReplaceNode(binding);
    if (attachEventHandler(binding)) {
      continue;
    }
    attachTwowayEventHandler(binding);
    attachRadioEventHandler(binding);
    attachCheckboxEventHandler(binding);

    if (STRUCTURAL_TYPES.has(binding.bindingType)) {
      structuralBindings.push(binding);
    } else if (binding.statePathName.includes(WILDCARD)) {
      // for ブロック内のバインディング → Content のバインディングとして登録済み
      continue;
    } else {
      normalBindings.push(binding);
    }
  }

  // 全バインディング（通常 + 構造）をアドレスに登録
  for (const binding of [...normalBindings, ...structuralBindings]) {
    const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
    addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    const rootNode = binding.replaceNode.getRootNode() as Node;
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    if (binding.bindingType !== 'event') {
      stateElement.setPathInfo(binding.statePathName, binding.bindingType);
    }
  }

  // for バインディングの lastListValue を初期値として設定
  // （次回の状態変化時に差分計算の基準になる）
  for (const binding of structuralBindings) {
    if (binding.bindingType === 'for') {
      const absAddr = getAbsoluteStateAddressByBinding(binding);
      const rootNode = binding.replaceNode.getRootNode() as Node;
      const stateElement = getStateElementByName(rootNode, binding.stateName);
      if (stateElement) {
        stateElement.createState("readonly", (state) => {
          const value = state[binding.statePathName];
          if (Array.isArray(value)) {
            setLastListValueByAbsoluteStateAddress(absAddr, value);
          }
        });
      }
    }
  }

  // 通常バインディングのみ初回値適用（構造バインディングはSSR描画済み）
  applyChangeFromBindings(normalBindings);

  // <wcs-ssr> を元に戻す
  for (const { el, parent, next } of ssrParents) {
    parent.insertBefore(el, next);
  }

  // hydrateProps 復元
  const restoredSsrElements = root.querySelectorAll(config.tagNames.ssr);
  for (const ssrNode of restoredSsrElements) {
    const ssrEl = ssrNode as Ssr;
    const props = ssrEl.hydrateProps;
    for (const [id, propMap] of Object.entries(props)) {
      const target = root.querySelector(`[data-wcs-ssr-id="${id}"]`);
      if (!target) continue;
      for (const [propName, value] of Object.entries(propMap)) {
        (target as any)[propName] = value;
      }
    }
  }

  // ハイドレーション中の重複登録防止用属性を除去
  const completedEls = root.querySelectorAll('[data-wcs-completed]');
  for (const el of completedEls) {
    el.removeAttribute('data-wcs-completed');
  }

  return true;
}
