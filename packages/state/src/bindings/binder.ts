import { BINDER_KEY, IWcsBinder, flushPendingBinds } from "../protocol/binder";
import { config } from "../config";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { hasInterestedSession } from "./BindingSession";
import { areBindingsBuilt } from "../stateElementByName";
import { initializeBindings } from "./initializeBindings";

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
  if (alreadyBound(subtree)) {
    return;
  }
  convertMustacheToComments(subtree);
  collectStructuralFragments(subtree.getRootNode(), subtree);
  // `getSubscriberNodes` の TreeWalker は**ルート自身を返さない**。`buildBindings` は
  // `document.body` を渡すので今まで問題にならなかったが、ここには宣言をルートに
  // 持つノードが来る（`<wcs-head>` が head へ入れる `<title data-wcs="…">`）。
  // そのときだけ親から走査して、ルートを走査範囲に含める。兄弟の重複登録は
  // `registeredNodeSet` が弾くので、余計なバインドは生まれない。
  // 親は Element とは限らない（ShadowRoot 直下なら DocumentFragment、head 直下なら
  // Element）。`parentElement` だと前者で null になり、ルートを含められない。
  const declaresOnRoot = subtree.hasAttribute(config.bindAttributeName);
  const parent = subtree.parentNode;
  const canWalkFromParent = parent !== null
    && (parent.nodeType === 1 || parent.nodeType === 9 || parent.nodeType === 11);
  const walkRoot = declaresOnRoot && canWalkFromParent
    ? (parent as Element | Document | DocumentFragment)
    : subtree;
  initializeBindings(walkRoot, null);
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
  if (!isElement(subtree) || alreadyBound(subtree)) {
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
