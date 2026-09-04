import { buildBindings } from "./buildBindings";
import { hydrateBindings } from "./hydrateBindings";
import { IStateElement } from "./components/types";
import { config, inSsr } from "./config";
import { raiseError } from "./raiseError";
import { devtoolsSink } from "./devtools/sink";
import { drainPendingBinds } from "./bindings/binder";
import { drainPendingVolumes } from "./webComponent/volumeShared";

// v2: 1 rootNode 1 ツリー（P3-6）。名前次元は無い — 追加の state はマウント（mount= / bind-component）で載る。
const stateElementByNode: WeakMap<Node, IStateElement> = new WeakMap();
const bindingsReadyByNode: WeakMap<Node, Promise<void>> = new WeakMap();

// devtools 用の列挙可能な登録簿（protocol §4.1 — 唯一の常時 ON 台帳）。
// サイズは <wcs-state> 要素数に拘束され、unregister（disconnectedCallback）で
// 必ず削除されるためリークしない。
const liveStateElements: Set<IStateElement> = new Set();

export function getLiveStateElements(): ReadonlySet<IStateElement> {
  return liveStateElements;
}

export function getStateElement(rootNode: Node): IStateElement | null {
  return stateElementByNode.get(rootNode) ?? null;
}

/**
 * 指定された rootNode のバインディング初期化が完了するまで待機する Promise を返す。
 */
export function getBindingsReady(rootNode: Node): Promise<void> {
  return bindingsReadyByNode.get(rootNode) ?? Promise.resolve();
}

const bindingsBuiltRoots: WeakSet<Node> = new WeakSet();

/**
 * マウントされたスコープ（コンポーネントの ShadowRoot）に、**親の** state element を
 * 別名として載せる（Phase 2・impl-plan §3-0 の 2）。
 *
 * `getRootNode()` で state element を解決する全てのサイト
 * （getAbsoluteStateAddressByBinding / applyChange / applyChangeFromBindings /
 * fragmentInfoByUUID）が、この 1 エントリで無改造のまま親ツリーに到達する。
 * `setStateElement` と違い、初回登録の副作用（buildBindings の起動・
 * liveStateElements・devtools イベント）は持たない — マウントスコープの構築は
 * webComponent/mountScope.ts が自前で行う。
 */
export function setStateElementAlias(rootNode: Node, element: IStateElement): void {
  const existing = stateElementByNode.get(rootNode);
  if (typeof existing !== "undefined") {
    // 再初期化（connectedCallback で shadow を張り直すコンポーネントの再接続）は
    // 同じ親を指し直すだけなので冪等。別要素への付け替えは設定ミス
    if (existing === element) {
      return;
    }
    raiseError(`A state tree is already registered on this root.`);
  }
  stateElementByNode.set(rootNode, element);
}

/**
 * マウントされたスコープの ready を登録する（`getBindingsReady(childShadow)` の互換面）。
 * 完了で binder の `areBindingsBuilt` も真にする。
 */
export function setBindingsReadyForScope(rootNode: Node, ready: Promise<void>): void {
  bindingsReadyByNode.set(rootNode, ready);
  ready.then(() => markBindingsBuilt(rootNode), () => undefined);
}

/**
 * この rootNode の初期バインド構築が完了しているか。
 *
 * binder プロトコル（`bind()`）が使う。router の `<wcs-head>` はクローンを
 * `connectedCallback` の中で head へ入れるので、**state が最初の走査を終える前**に
 * bind を求めてくる。そこで同期に束ねても state 要素の初期化が済んでおらず、
 * 結果は空のままになる。完了までは binder 側で保留する。
 *
 * 「まだ登録も済んでいない」と「もう構築が終わった」を取り違えないよう、判定は
 * 完了の側で持つ。<wcs-state> の登録は connectedCallback の await より後に起きるので、
 * 「エントリの有無」で進行中かを測ると読み込み順によって逆の答えを返す。
 */
export function areBindingsBuilt(rootNode: Node): boolean {
  return bindingsBuiltRoots.has(rootNode);
}

function markBindingsBuilt(rootNode: Node): void {
  bindingsBuiltRoots.add(rootNode);
}

export function setStateElement(rootNode: Node, element: IStateElement | null): void {

  const existing = stateElementByNode.get(rootNode);

  if (element === null) {
    // 削除の場合、登録が無ければ何もしない
    if (existing === undefined) {
      return;
    }
    stateElementByNode.delete(rootNode);
    liveStateElements.delete(existing);
    if (devtoolsSink !== null) {
      devtoolsSink({ type: "state:element-unregistered", rootNode, element: existing });
    }
    if (config.debug) {
      console.debug(`State element unregistered`);
    }
  } else {
    // 登録の場合
    if (existing === undefined) {
      // 初めてルートノードに登録する場合
      // enable-ssr 属性があり、サーバーサイドでない場合はハイドレーション
      const enableSsr = !inSsr() && (element as unknown as Element).hasAttribute?.('enable-ssr');
      // instanceof ではなく constructor.name で判定するのは意図的。SSR では
      // @wcstack/server の installGlobals が happy-dom の一部だけを globalThis に載せるが、
      // そのリスト（GLOBALS_KEYS）に `Document` は入っていない。Node にも `Document` は
      // 無いので `rootNode instanceof Document` は ReferenceError になる。
      // `ShadowRoot` はリストに含まれるため他所では instanceof を使っている
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §3.3）。
      // reject を配管しないと、バインディング初期化中の例外は unhandled rejection として
      // 漏れるだけで ready が永久に未解決のまま残り、await getBindingsReady() の先が
      // 無言でハングする（docs/state-bind-component-nested-for-design.md §8.2）。
      if (rootNode.constructor.name === 'HTMLDocument' || rootNode.constructor.name === 'Document') {
        const ready = new Promise<void>((resolve, reject) => {
          queueMicrotask(async () => {
            try {
              if (enableSsr) {
                const success = await hydrateBindings(rootNode as Document);
                if (!success) {
                  await buildBindings(rootNode as Document);
                }
              } else {
                await buildBindings(rootNode as Document);
              }
              markBindingsBuilt(rootNode);
              // binder が居ない時点で差し出されたサブツリーを引き取る。ここが
              // 「state が確実に居る」最初の瞬間で、router の auto バンドルが
              // state のそれより先に走る順序を吸収できる唯一の場所である。
              drainPendingBinds();
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
        bindingsReadyByNode.set(rootNode, ready);
      } else if (rootNode.constructor.name === 'ShadowRoot') {
        const ready = new Promise<void>((resolve, reject) => {
          queueMicrotask(async () => {
            try {
              await buildBindings(rootNode as ShadowRoot);
              markBindingsBuilt(rootNode);
              // binder が居ない時点で差し出されたサブツリーを引き取る。ここが
              // 「state が確実に居る」最初の瞬間で、router の auto バンドルが
              // state のそれより先に走る順序を吸収できる唯一の場所である。
              drainPendingBinds();
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
        bindingsReadyByNode.set(rootNode, ready);
      }
    }
    if (existing !== undefined) {
      // v2 は 1 rootNode 1 ツリー。2 つ目の <wcs-state> は設定エラー — 追加の状態は
      // マウント（mount= / ホスト配線の bind-component）でツリーに載せる
      raiseError(
        `A state tree is already registered on this root — one <wcs-state> per root in v2. ` +
        `Mount additional states onto the tree instead: <wcs-state mount="...">.`,
      );
    }
    stateElementByNode.set(rootNode, element);
    liveStateElements.add(element);
    // ルートの登録は、先に接続されて保留中のボリュームを引き取る
    //（webComponent/volume.ts・ロード順に依存しない — V5）
    drainPendingVolumes(rootNode, element);
    if (devtoolsSink !== null) {
      devtoolsSink({ type: "state:element-registered", rootNode, element });
    }
    if (config.debug) {
      console.debug(`State element registered`, element);
    }
  }
}
