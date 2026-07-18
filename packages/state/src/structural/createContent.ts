import { clearAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding.js";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo.js";
import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent.js";
import { getBindingSessionByContent, setBindingSessionByContent } from "../bindings/bindingSessionByContent.js";
import { markNodeRegistered } from "../bindings/collectNodesAndBindingInfos.js";
import { setIndexBindingsByContent } from "../bindings/indexBindingsByContent.js";
import { initializeBindingsByFragment, initializeRowBindings } from "../bindings/initializeBindings.js";
import { resolveInitializedBinding } from "../bindings/initializeBindingPromiseByNode.js";
import { setNodesByContent } from "../bindings/nodesByContent.js";
import { markObserverSkipOnAdd, markObserverSkipOnRemove } from "../bindings/observerSkip.js";
import { config } from "../config.js";
import { INDEX_BY_INDEX_NAME } from "../define.js";
import { raiseError } from "../raiseError.js";
import { IBindingInfo } from "../types.js";
import { getContentSetByNode, setContentByNode } from "./contentsByNode.js";
import { getFragmentInfoByUUID } from "./fragmentInfoByUUID.js";
import { resolveNodePath } from "./resolveNodePath.js";
import { compileRowPlan } from "./rowPlan.js";
import { IContent, IFragmentInfo, IRowPlan } from "./types.js";

const recursiveBindingTypes = new Set(['if', 'elseif', 'else', 'for']);

class Content implements IContent {
  private _content: DocumentFragment;
  private _childNodeArray: Node[] = [];
  private _firstNode: Node | null = null;
  private _lastNode: Node | null = null;
  private _mounted: boolean = false;
  constructor(content: DocumentFragment) {
    this._content = content;
    this._childNodeArray = Array.from(this._content.childNodes);
    this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
    this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
  }

  get firstNode(): Node | null {
    return this._firstNode;
  }

  get lastNode(): Node | null {
    return this._lastNode;
  }

  get mounted(): boolean {
    return this._mounted;
  }

  appendTo(targetNode: Node): void {
    for(const node of this._childNodeArray) {
      // framework 起点のマウントを observer に伝える。中間 fragment へ append する
      // 経路でも、後続の一括 insertBefore(fragment) の mutation record には
      // この top-level node が addedNodes として現れるため、ここでのマークが届く。
      markObserverSkipOnAdd(node);
      targetNode.appendChild(node);
    }
    this._mounted = true;
  }

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    const nextSibling = targetNode.nextSibling;
    if (parentNode) {
      for(const node of this._childNodeArray) {
        markObserverSkipOnAdd(node);
        parentNode.insertBefore(node, nextSibling);
      }
    }
    this._mounted = true;
  }

  tryDestroy(): boolean {
    const session = getBindingSessionByContent(this);
    // session 無し（SSR ハイドレーション産）や、定義待ち・connect-snapshot 待ちを
    // 抱える content は teardown 省略でリークするため従来経路に倒す。
    if (session === null || !session.canWholesaleDestroy()) {
      return false;
    }
    session.destroyRecords();
    for (const node of this._childNodeArray) {
      // unmount と同じ理由の observer 向け削除マーク（clear の一括削除でも
      // top-level node が mutation record の root に現れる）
      markObserverSkipOnRemove(node);
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
    const bindings = getBindingsByContent(this);
    for (const binding of bindings) {
      if (recursiveBindingTypes.has(binding.bindingType)) {
        const contents = getContentSetByNode(binding.node);
        for (const content of contents) {
          if (!content.tryDestroy()) {
            content.unmount();
          }
        }
      }
    }
    this._mounted = false;
    return true;
  }

  unmount(): void {
    getBindingSessionByContent(this)?.dispose();
    for(const node of this._childNodeArray) {
      // framework 起点の削除であることを observer に伝える。clear の
      // parentNode.textContent='' 一括削除でも、この top-level node が
      // 削除サブツリーの root として mutation record に現れるため、ここで
      // マークしておけば observer の冗長走査をスキップできる。マークは
      // 同期実行中に立ち、observer は次 microtask で読むので順序は保証される。
      markObserverSkipOnRemove(node);
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
    const bindings = getBindingsByContent(this);
    for(const binding of bindings) {
      if (recursiveBindingTypes.has(binding.bindingType)) {
        const contents = getContentSetByNode(binding.node);
        for (const content of contents) {
          content.unmount();
        }
      }
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBinding(binding);
    }
    this._mounted = false;
  }
}

/**
 * SSR ハイドレーション用: 既存の DOM ノード配列から Content を生成する。
 * テンプレートからの clone ではなく、SSR で描画済みのノードをそのまま使う。
 */
export function createContentFromNodes(
  nodes: Node[],
): IContent {
  const fragment = document.createDocumentFragment();
  // ノードを fragment に移動せず、参照だけ持つ Content を作る
  const content = new Content(fragment);
  // Content の内部状態を直接設定
  (content as any)._childNodeArray = nodes;
  (content as any)._firstNode = nodes.length > 0 ? nodes[0] : null;
  (content as any)._lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  (content as any)._mounted = true; // SSR で既にマウント済み
  return content;
}

/**
 * RowPlan 経路の実体化: clone → nodePath 解決 → スロットから薄い binding を複製 →
 * initializeRowBindings。パース再生（spread 展開・remember・キー文字列・options
 * オブジェクト・policy 再解決）を行ごとに繰り返さない
 * （docs/state-row-instantiation-redesign.md §3-1/§3-2）。
 */
function createPlanContent(
  bindingInfo: IBindingInfo,
  fragmentInfo: IFragmentInfo,
  plan: IRowPlan,
): IContent {
  const cloneFragment = document.importNode(fragmentInfo.fragment, true);
  const nodeInfos = fragmentInfo.nodeInfos;
  const nodes: Node[] = new Array(nodeInfos.length);
  for (let i = 0; i < nodeInfos.length; i++) {
    const node = resolveNodePath(cloneFragment, nodeInfos[i].nodePath);
    if (node === null) {
      raiseError(`Node not found by path [${nodeInfos[i].nodePath.join(', ')}] in fragment.`);
    }
    // 再スキャン防止と初期化完了マークは従来経路と同じ台帳に載せる
    markNodeRegistered(node);
    resolveInitializedBinding(node);
    nodes[i] = node;
  }
  const slots = plan.slots;
  const bindings: IBindingInfo[] = new Array(slots.length);
  const indexBindings: IBindingInfo[] = [];
  for (let k = 0; k < slots.length; k++) {
    const slot = slots[k];
    const node = nodes[slot.nodeIndex];
    // text スロットは事前正規化済みの Text がそのまま replaceNode（従来経路の
    // getBindingInfos と同じ帰結）。prop/event は node === replaceNode
    const binding: IBindingInfo = { ...slot.template, node, replaceNode: node };
    bindings[k] = binding;
    if (slot.isIndexBinding) {
      indexBindings.push(binding);
    }
  }
  const session = initializeRowBindings(plan, bindings);
  const content = new Content(cloneFragment);
  setBindingSessionByContent(content, session);
  setBindingsByContent(content, bindings);
  setIndexBindingsByContent(content, indexBindings);
  setNodesByContent(content, nodes);
  setContentByNode(bindingInfo.node, content);
  return content;
}

export function createContent(
  bindingInfo: IBindingInfo,
): IContent {
  if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
    raiseError(`BindingInfo.uuid is null.`);
  }
  const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
  if (!fragmentInfo) {
    raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
  }
  let plan = fragmentInfo.rowPlan;
  if (typeof plan === 'undefined' || (plan !== null && plan.directional !== config.enableDirectionalInitialSync)) {
    // 初回 or config（directional）が変わったときだけコンパイル。不適格は null を
    // キャッシュして以後は従来経路へ直行する
    plan = fragmentInfo.rowPlan = compileRowPlan(fragmentInfo);
  }
  if (plan !== null) {
    return createPlanContent(bindingInfo, fragmentInfo, plan);
  }
  const cloneFragment = document.importNode(fragmentInfo.fragment, true);
  const initialInfo = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos);
  const content = new Content(cloneFragment);
  setBindingSessionByContent(content, initialInfo.bindingSession);
  setBindingsByContent(content, initialInfo.bindingInfos);
  const indexBindings: IBindingInfo[] = [];
  for(const binding of initialInfo.bindingInfos) {
    if (binding.statePathName in INDEX_BY_INDEX_NAME) {
      indexBindings.push(binding);
    }
  }
  setIndexBindingsByContent(content, indexBindings);
  setNodesByContent(content, initialInfo.nodes);
  setContentByNode(bindingInfo.node, content);
  return content;
}
