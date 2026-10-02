import { BINDER_KEY, IWcsBinder, flushPendingBinds } from "../protocol/binder";
import { config } from "../config";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { BindingSession, hasInterestedSession } from "./BindingSession";
import { areBindingsBuilt } from "../stateElementByName";
import { initializeBindings } from "./initializeBindings";
import { getSubscriberNodes } from "./getSubscriberNodes";
import { isLightDomMappedStateElement } from "./lightDomComponentScope";

/**
 * binder プロトコルの提供側（docs/binder-protocol-design.md）。
 *
 * `buildBindings` は起動時に `document.body` を 1 回走査するだけなので、そのとき
 * document に居なかったノードのバインドは存在しない。router が後から差し込む
 * ルート内容や `<wcs-head>` のクローンがこれに当たり、書いたバインドが黙って
 * 何もしない状態になっていた。`bind()` はその取りこぼしを 1 サブツリー分だけ
 * 埋める。
 *
 * **走査を勝手に広げない。** MutationObserver が見た全追加ノードを走査する形に
 * すると、バインドを 1 個も持たない挿入（大多数）にコストが乗り、さらに
 * `innerHTML` で入れた外部由来の DOM が `data-wcs` を発火させることになる。
 * ここで束ねるのは**明示的に渡されたものだけ**である。
 */
const BIND_ATTRIBUTE_SELECTOR = (): string => `[${config.bindAttributeName}]`;

/**
 * このサブツリーは既にバインド済みか。
 *
 * ルート内容は「起動時に active だったので全部バインド済み」か「一度も走査されて
 * いないので全部未バインド」のどちらかで、途中の状態を取らない。したがって
 * **宣言を持つ最初のノード 1 個**を見れば足りる。全ノードを走査して判定するのは
 * 同じ結論により高いコストを払うだけになる。
 */
function alreadyBound(subtree: Node): boolean {
  if (hasInterestedSession(subtree)) {
    return true;
  }
  if (!isElement(subtree)) {
    return false;
  }
  if (subtree.hasAttribute(config.bindAttributeName)) {
    // 属性を持つのに台帳に居ない ＝ 未バインド
    return false;
  }
  const first = subtree.querySelector(BIND_ATTRIBUTE_SELECTOR());
  return first !== null && hasInterestedSession(first);
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function bindNow(subtree: Element): void {
  // A subtree no longer in the document is left alone: one held until the first build may have
  // left it since (the build's own walk replaces a structural template handed over with its anchor).
  if (!subtree.isConnected || alreadyBound(subtree)) {
    return;
  }
  // Bind inside the subtree only, its root included (#409). `getSubscriberNodes`'s TreeWalker never
  // returns its root, and roots that declare on themselves do come here (`<wcs-head>`'s
  // `<title data-wcs="…">`, a route's content handed over node by node), so the root is taken in by
  // hand — the shape SSR's hydration uses. This used to walk from the parent instead, which also
  // reached the root's siblings: a later sibling's structural template, not collected yet, was
  // registered as a plain binding, failed to apply and was never rendered, and siblings nobody
  // handed over were bound.
  const nodes: Node[] = subtree.hasAttribute(config.bindAttributeName) ? [subtree] : [];
  // A Light DOM mount (wired from the host, its `<wcs-state bind-component>` right under it): the
  // root's declarations belong to the host, and what is inside to the component's scope, which
  // collects it once wired (§1.13 — `getSubscriberNodes` prunes a nested one, never its walk root).
  if (!Array.from(subtree.children).some(
    (child) => child.localName === config.tagNames.state && isLightDomMappedStateElement(child))) {
    convertMustacheToComments(subtree);
    collectStructuralFragments(subtree.getRootNode(), subtree);
    nodes.push(...getSubscriberNodes(subtree));
  }
  // A session of its own, keyed by nothing. A session found by its root is what a scope disposes as a
  // whole: keyed by `subtree`, a Light DOM mount's host bindings joined the mount scope's session
  // (keyed by the component), and its re-initialization tore them down.
  initializeBindings(subtree, null, undefined, nodes, new BindingSession());
}

/**
 * 初期バインド構築より前に差し出されたサブツリー。
 *
 * `<wcs-head>` は `connectedCallback` の中でクローンを head へ入れるので、
 * state / router のどちらを先に読み込んでも「まだ構築が終わっていない」時点で
 * bind を求めてくる。そこで同期に束ねても `<wcs-state>` の登録が済んでおらず、
 * バインドは state を見つけられない。**構築の完了を唯一の合図にする。**
 */
const beforeFirstBuild: Element[] = [];

function bind(subtree: Node): void {
  // Nothing to bind in a subtree not in a document (held, it would wait for a build that never comes)
  if (!isElement(subtree) || !subtree.isConnected || alreadyBound(subtree)) {
    return;
  }
  if (!areBindingsBuilt(subtree.getRootNode())) {
    beforeFirstBuild.push(subtree);
    return;
  }
  bindNow(subtree);
}

/**
 * 初期バインド構築の完了時に呼ぶ（stateElementByName.ts）。binder が居ない時点で
 * 差し出された分（プロトコルの保留キュー）と、居たが早すぎた分をまとめて束ねる。
 */
export function drainPendingBinds(): void {
  const pending = beforeFirstBuild.splice(0, beforeFirstBuild.length);
  for (const subtree of pending) {
    bindNow(subtree);
  }
  flushPendingBinds();
}

const binder: IWcsBinder = {
  protocol: "wcs-binder",
  version: 1,
  bind,
};

/**
 * グローバル symbol へ自分を載せる。`bootstrapState` から呼ぶ。
 *
 * 既に別のコピーが載っているなら譲る。1 ページに 2 つの state バンドルが載る構成
 * （CDN の取り違え）で、後から読まれた側が先客を追い出すと、先客がバインドした
 * ノードの台帳と食い違う。
 */
export function registerBinder(): void {
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[BINDER_KEY] === undefined) {
    globals[BINDER_KEY] = binder;
  }
  // ここでは引き取らない。`<wcs-state>` の登録は connectedCallback の await より
  // 後なので、この時点ではまだ state が居ない。保留分は初期バインド構築の完了時に
  // 流す（stateElementByName.ts）。そこが「state が確実に居る」最初の瞬間である。
}

/** テスト用: 登録を外す */
export function _unregisterBinder(): void {
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[BINDER_KEY] === binder) {
    delete globals[BINDER_KEY];
  }
}
