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
import { config, inSsr } from "../config.js";
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
  /**
   * 範囲モード。トップレベルに構造ディレクティブを持つ content でのみ true。
   * この content の実レンジは自分の childNodeArray より広い（ネストした
   * if/for が自分のアンカー直後に実ノードを挿すため）ので、移動は
   * firstNode..lastNode の DOM レンジで行う。
   */
  private _ranged: boolean = false;
  constructor(content: DocumentFragment, ranged: boolean = false) {
    this._content = content;
    this._ranged = ranged;
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

  /**
   * 移動対象ノード列。通常は自分のトップレベルノードそのもの（同一参照を返すので
   * 追加アロケーション無し）。範囲モードでマウント中のときだけ、ネストした構造
   * ディレクティブが挿した実ノードを含む DOM レンジを収集する。
   */
  private _movableNodes(): Node[] {
    if (!this._ranged || !this._mounted) {
      return this._childNodeArray;
    }
    const first = this._firstNode;
    const last = this._lastNode;
    if (first === null || last === null || first.parentNode === null) {
      return this._childNodeArray;
    }
    // 移動でsiblingが変わるため、先に列を確定させてから動かす
    const nodes: Node[] = [];
    for (let node: Node | null = first; node !== null; node = node.nextSibling) {
      nodes.push(node);
      if (node === last) {
        return nodes;
      }
    }
    // last へ到達しない（想定外の不連続）→ 従来どおり自分のノードだけ動かす
    return this._childNodeArray;
  }

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    if (parentNode) {
      // マウント済み content にも再突入する（if の true→true 再適用・SSR
      // ハイドレーション産 content 等）。固定の nextSibling へ一括 insertBefore
      // すると、マウント済みでは nextSibling が自分の先頭ノードを指すため
      // 先頭ノードが末尾へ回転する。anchor を進めながら位置一致ノードを
      // スキップすることで冪等にする（mutation record も発生させない）。
      let anchor: Node = targetNode;
      for(const node of this._movableNodes()) {
        if (anchor.nextSibling !== node) {
          markObserverSkipOnAdd(node);
          parentNode.insertBefore(node, anchor.nextSibling);
        }
        anchor = node;
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
 * トップレベルに構造ディレクティブのプレースホルダを持つか。
 *
 * これを持つ content は、ネストした if/for が「自分のアンカー直後」に実ノードを
 * 挿すため、自分の childNodeArray が実レンジより狭くなる。その状態だと
 * (1) 呼び出し側の位置追跡（applyChangeToFor の lastNode）が実ノードの手前で
 * 止まり後続行が割り込む、(2) 移動時にネスト分を置き去りにする、の 2 つが起きる。
 * 該当テンプレートにだけ終端マーカーを持たせて実レンジを閉じる。
 */
function hasTopLevelStructural(fragment: DocumentFragment): boolean {
  // config は setConfig で差し替わりうるので都度組む。テンプレート単位に一度しか
  // 走らない判定なので、この生成コストが行あたりに乗ることはない。
  const structural = new RegExp(
    `^@@(?:${config.commentForPrefix}|${config.commentIfPrefix}`
    + `|${config.commentElseIfPrefix}|${config.commentElsePrefix}):`,
  );
  for (let node = fragment.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType !== Node.COMMENT_NODE) {
      continue;
    }
    // Comment の data は常に文字列（textContent の null 分岐を持ち込まない）
    if (structural.test((node as Comment).data)) {
      return true;
    }
  }
  return false;
}

/**
 * 範囲モードの要否をテンプレート単位で一度だけ判定してキャッシュする。
 * 大多数のテンプレート（トップレベルが素の要素）は false を引くだけで、
 * 行ごとの追加コストはゼロ。
 */
function resolveRanged(fragmentInfo: IFragmentInfo): boolean {
  let ranged = fragmentInfo.topLevelStructural;
  if (typeof ranged === 'undefined') {
    ranged = fragmentInfo.topLevelStructural = hasTopLevelStructural(fragmentInfo.fragment);
  }
  return ranged;
}

const ROW_END_PREFIX = 'wcs-row-end';

/**
 * 終端マーカーの付与。バインディング初期化の後に足すので nodePath 解決には影響しない
 * （末尾追加なので既存 index もずれない）。SSR 描画中は付けない — SSR は行ごとに
 * `@@wcs-for-start/end` を出力しており、そちらがレンジの正本かつハイドレーション
 * が読む対象なので、余計なコメントを混ぜない。
 */
function appendRowEndMarker(cloneFragment: DocumentFragment, uuid: string): void {
  cloneFragment.appendChild(document.createComment(`${ROW_END_PREFIX}:${uuid}`));
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
  // プラン経路の content は範囲モードにならない: compileRowPlan は bindingType が
  // text / prop / event のもの以外（= for / if / elseif / else）を含む時点で不適格に
  // するため、プラン適格なフラグメントはトップレベル構造アンカーを持ち得ない。
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
  // SSR 描画中は行ごとの @@wcs-for-start/end がレンジの正本なので終端マーカーは付けない
  const ranged = !inSsr() && resolveRanged(fragmentInfo);
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
  if (ranged) {
    // uuid は冒頭のガードで非 null が確定している（raiseError は never を返す）
    appendRowEndMarker(cloneFragment, bindingInfo.uuid);
  }
  const content = new Content(cloneFragment, ranged);
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
