/**
 * webComponent/volumeShared.ts — ボリュームの軽量共有面。
 *
 * ホットパス（proxy/methods/getByAddress・proxy/apis/updatedCallback・pathDiagnostics）が
 * 引く台帳と chroot だけを置く。graft 本体（webComponent/volume.ts）は watch runtime 等の
 * 重い依存を持つため、ここに混ぜると「updater を部分モックするテスト」が import 連鎖で
 * 壊れる（watchRuntime は import 時に drain リスナーを登録する）。
 */

import { DELIMITER, MODIFIER_READONLY, VOLUME_INJECTION_PROP } from "../define";
import { raiseError } from "../raiseError";
import { IStateElement } from "../components/types";
import { findMountEntry, IMountEntry, translateByMountEntry } from "./mountEntries";
import { createDollarPathApiWrapper } from "./dollarPathApis";

/**
 * 予約済みスロット（D22）。キーは rootNode、値はマウントパス → 予約した要素（所有者）。
 * 所有者が `null` の枠は持ち主を手放した枠（#265）: 読みの寛容（予約下の読みは undefined・
 * 存在の診断は黙る）はそのまま残し、同じマウントパスを別の要素が予約できる。
 */
const reservedSlotsByRootNode = new WeakMap<Node, Map<string, object | null>>();

export function reserveVolumeSlot(rootNode: Node, mountPath: string, owner: object): void {
  let slots = reservedSlotsByRootNode.get(rootNode);
  if (typeof slots === "undefined") {
    slots = new Map();
    reservedSlotsByRootNode.set(rootNode, slots);
  }
  const current = slots.get(mountPath);
  if (typeof current !== "undefined" && current !== null) {
    raiseError(`Volume slot "${mountPath}" is already mounted on this tree.`);
  }
  slots.set(mountPath, owner);
}

/**
 * 予約を手放す（#265）。`owner` がその枠を予約した要素のときだけ手放す。
 *
 * 所有者を確かめずに手放すと、枠を失った要素（孤児・ロード失敗）の後始末が、同じマウントパスで
 * 後から予約した**生きている別の要素**の枠を奪う（#257 第 3 ラウンドで実測した横取り）。
 * 呼び手は予約した `(rootNode, mountPath)` の組を自分で控えておき、それを渡すこと —
 * 切断時の rootNode や `mount` 属性から読み直した組は、予約した組と一致する保証が無い。
 *
 * 台帳から消さずに持ち主だけを外すのは、読みの寛容を残すため。消すと、接ぎ木しなかった
 * ボリュームの配下を読むページ（ルートの getter・バインド）が「存在しないパス」の raise に変わり、
 * ロード失敗を 1 ボリュームに閉じる規範が破れる。
 */
export function releaseVolumeSlot(rootNode: Node, mountPath: string, owner: object): void {
  const slots = reservedSlotsByRootNode.get(rootNode);
  if (slots?.get(mountPath) === owner) {
    slots.set(mountPath, null);
  }
}

/**
 * パスが予約済みスロットの配下（または祖先）か。pathDiagnostics と getByAddress の
 * ルート欠落 raise が「予約下の読みは undefined が正」（D22）のために引く。
 */
export function isPathUnderReservedVolume(rootNode: Node | null, path: string): boolean {
  if (rootNode === null) {
    return false;
  }
  const slots = reservedSlotsByRootNode.get(rootNode);
  if (typeof slots === "undefined" || slots.size === 0) {
    return false;
  }
  for (const slot of slots.keys()) {
    if (path === slot || path.startsWith(slot + DELIMITER) || slot.startsWith(path + DELIMITER)) {
      return true;
    }
  }
  return false;
}

/** このルートに予約（手放した枠も台帳に残る）があるか — ルート登録時にスコープ機能の hook を付ける判定 */
export function hasReservedVolumeSlots(rootNode: Node): boolean {
  const slots = reservedSlotsByRootNode.get(rootNode);
  return typeof slots !== "undefined" && slots.size > 0;
}

/**
 * 接ぎ木済みスロット（D22 後段）。キーはルートの state element。
 * setByAddress のガード（findGraftedSlotUnder）と graftVolume（recordGraftedSlot）が使う。
 * 予約（reservedSlots）と別台帳なのは、接ぎ木**前**の中間 `{}` 生成
 * （graftVolume の親作成）をガードに掛けないため。
 */
const graftedSlotsByStateElement = new WeakMap<IStateElement, Set<string>>();

export function recordGraftedSlot(stateElement: IStateElement, mountPath: string): void {
  let slots = graftedSlotsByStateElement.get(stateElement);
  if (typeof slots === "undefined") {
    slots = new Set();
    graftedSlotsByStateElement.set(stateElement, slots);
  }
  slots.add(mountPath);
}

/**
 * 書き込みパスが接ぎ木済みスロットの**真の祖先**なら、そのスロットを返す（D22 後段）。
 * マウントポイントを含む親の丸ごと書きは、接ぎ木データを無言で捨てて quoted-path
 * アクセサだけを宙に浮かせるため throw の根拠になる。スロット自身への書き込みは
 * 通常のデータ差し替えなので対象外。`hasGraftedVolumes` が真のときだけ呼ぶこと。
 */
export function findGraftedSlotUnder(stateElement: IStateElement, path: string): string | null {
  const slots = graftedSlotsByStateElement.get(stateElement);
  if (typeof slots === "undefined" || slots.size === 0) {
    return null;
  }
  const prefix = path + DELIMITER;
  for (const slot of slots) {
    if (slot.startsWith(prefix)) {
      return slot;
    }
  }
  return null;
}

const NO_INJECTIONS: readonly IMountEntry[] = [];

/**
 * ボリューム相対のパスをルートの絶対パスへ翻訳する。注入口（`state.taxRate: settings.taxRate`、
 * 要件 B14③）の最長一致が先で、一致しなければ `<mountPath>.<path>`。`write` なら、読み取り専用で
 * 注入したキー（`state.taxRate#ro: …`）への書き込みを名指しで拒否する（コンポーネントの
 * `translateInnerWritePath` と同じ規則・同じコード）。
 */
export function translateVolumePath(
  mountPath: string,
  injections: readonly IMountEntry[],
  path: string,
  write: boolean,
): string {
  if (injections.length > 0) {
    const segments = path.split(DELIMITER);
    const entry = findMountEntry(injections, segments);
    if (entry !== null) {
      if (write && entry.readonly) {
        raiseError(
          `[wcs/mount-readonly] volume "${mountPath}" cannot write "${path}": it is injected read-only ` +
          `("${VOLUME_INJECTION_PROP}.${entry.innerSegments.join(DELIMITER)}#${MODIFIER_READONLY}: ${entry.outerPathInfo.path}"). ` +
          `Write "${entry.outerPathInfo.path}" on the root, or drop #${MODIFIER_READONLY} from the injection.`,
        );
      }
      return translateByMountEntry(entry, segments);
    }
  }
  return mountPath + DELIMITER + path;
}

/**
 * ルートの絶対パスを、ボリュームから見た相対パスへ戻す（`$updatedCallback` の相対配送）。
 * 注入したパスは内側の名前で返す（3.x 計画 D33）。ボリュームに関係なければ null、マウントポイント自身は ""。
 *
 * 一致は**外側パスの最長一致**（宣言順の先頭一致ではない）。読みの翻訳（`translateVolumePath` →
 * `findMountEntry`）が内側接頭辞の最長一致なので、その逆翻訳も最長一致でないと、外側パスが
 * 入れ子になる 2 つの注入（`state.a: settings; state.b: settings.tax`）で
 * 「読みは `b`、`$renderedCallback` に届くのは `a.tax`」という宣言順依存の食い違いになる。
 * マウントポイント自身も候補に含める（`mount="settings.cart"` ＋ `state.a: settings` で
 * `settings.cart.x` が `a.cart.x` でなく `x` として届く）。
 */
export function relativeVolumePath(mountPath: string, injections: readonly IMountEntry[], path: string): string | null {
  let bestLength = -1;
  let best: string | null = null;
  for (const entry of injections) {
    const outer = entry.outerPathInfo.path;
    if (outer.length <= bestLength) {
      continue;
    }
    if (path === outer) {
      bestLength = outer.length;
      best = entry.innerSegments.join(DELIMITER);
    } else if (path.startsWith(outer + DELIMITER)) {
      bestLength = outer.length;
      best = entry.innerSegments.join(DELIMITER) + path.slice(outer.length);
    }
  }
  if (mountPath.length > bestLength) {
    if (path === mountPath) {
      return "";
    }
    if (path.startsWith(mountPath + DELIMITER)) {
      return path.slice(mountPath.length + 1);
    }
  }
  return best;
}

/**
 * ボリュームの chroot（相対キー → ルートの絶対パスを receiver に翻訳する薄い proxy）。
 * 翻訳は translateVolumePath — 注入口があればそちら、無ければ `<mountPath>.<key>`。
 */
export function createVolumeChroot(mountPath: string, receiver: any, injections: readonly IMountEntry[] = NO_INJECTIONS): Record<string, any> {
  return new Proxy({} as Record<string, any>, {
    get(_target, prop): any {
      if (typeof prop !== "string" || prop === "then") {
        return undefined;
      }
      if (prop[0] === "$") {
        if (prop === "$postUpdate" || prop === "$getAll") {
          const api = prop;
          return (path: string, ...rest: unknown[]): unknown =>
            receiver[api](translateVolumePath(mountPath, injections, path, false), ...rest);
        }
        if (prop === "$setAll") {
          return (path: string, ...rest: unknown[]): unknown =>
            receiver.$setAll(translateVolumePath(mountPath, injections, path, true), ...rest);
        }
        if (prop === "$resolve") {
          // 読みか書きかは引数の個数で決まる（要件 B7）— 個数を変えずに渡し、書きだけ `#ro` を検査する
          return (path: string, ...rest: unknown[]): unknown =>
            receiver.$resolve(translateVolumePath(mountPath, injections, path, rest.length > 1), ...rest);
        }
        // パスだけを取る読みの API（`$eq` / `$eqPath` / `$eqIndex` / `$dependOn`）は共有の表で包む
        const wrapped = createDollarPathApiWrapper(
          prop,
          (path) => translateVolumePath(mountPath, injections, path, false),
          (args) => (receiver[prop] as (...a: unknown[]) => unknown)(...args),
        );
        if (wrapped !== null) {
          return wrapped;
        }
        // 他の `$` は親の意味論のまま（宣言面はボリュームが登録時に翻訳する）
        return receiver[prop];
      }
      return receiver[translateVolumePath(mountPath, injections, prop, false)];
    },
    set(_target, prop, value): boolean {
      if (typeof prop !== "string") {
        return true;
      }
      if (prop[0] === "$") {
        // `$` の予約名前空間は親の意味論のまま（get と対称・コンポーネントの chroot と同じ）。
        // 翻訳すると `this.$foo = 1` が `cart.$foo` というツリーのゴミキーを無言で作る
        receiver[prop] = value;
        return true;
      }
      receiver[translateVolumePath(mountPath, injections, prop, true)] = value;
      return true;
    },
    has(_target, prop): boolean {
      // ボリュームの面はツリーそのもの — マウント配下は常に解決する
      return typeof prop === "string" && prop[0] !== "$" && prop[0] !== "#";
    },
  });
}

/** ボリュームの相対 $updatedCallback（ルート state 要素 → 登録リスト）。 */
export interface IVolumeUpdatedCallback {
  readonly mountPath: string;
  /** 注入口（B14③）。注入したパスの更新は内側の名前で届く */
  readonly injections: readonly IMountEntry[];
  readonly callback: (this: unknown, paths: string[], indexesListByPath: Record<string, Array<number[]>>) => unknown;
}
const volumeUpdatedCallbacksByRoot = new WeakMap<IStateElement, IVolumeUpdatedCallback[]>();

const NO_VOLUME_UPDATED_CALLBACKS: readonly IVolumeUpdatedCallback[] = [];

export function addVolumeUpdatedCallback(stateElement: IStateElement, entry: IVolumeUpdatedCallback): void {
  let callbacks = volumeUpdatedCallbacksByRoot.get(stateElement);
  if (typeof callbacks === "undefined") {
    callbacks = [];
    volumeUpdatedCallbacksByRoot.set(stateElement, callbacks);
  }
  callbacks.push(entry);
  // 相対配送はルートに付いた updated hook が行う（接ぎ木が途中で落ちても配送先は付いている）
  stateElement.markHasVolume?.();
}

export function getVolumeUpdatedCallbacks(stateElement: IStateElement): readonly IVolumeUpdatedCallback[] {
  return volumeUpdatedCallbacksByRoot.get(stateElement) ?? NO_VOLUME_UPDATED_CALLBACKS;
}

/**
 * ルート登録待ちのボリューム（stateElementByName が引き取りを起動する）。
 * graft の実体（webComponent/volume.ts）は import 時にハンドラを注入する —
 * stateElementByName → volume の直接 import は updater までの循環を作るため。
 */
export interface IPendingVolumeRequest {
  readonly mountPath: string;
  readonly volumeState: Record<string, any>;
  /** ボリューム要素の注入口（`state.<key>: path`、B14③） */
  readonly injections: readonly IMountEntry[];
  readonly onGrafted: (info: unknown) => void;
  /**
   * 接ぎ木の直前に、要求した要素がマウントの枠を取る（#265）。握っていれば真、空いていれば取り直して真、
   * 別の要素が握っていれば偽（報告は取る側が出す）。ロード中・保留中に外れた要素は枠を返しているので、
   * ここで取り直す — 外れたままでも接ぎ木する従来の着地を保ちつつ、その間に同じマウントパスを取った
   * 別のボリュームと二重に接ぎ木しない。
   */
  readonly acquireSlot: () => boolean;
}
const pendingVolumesByRootNode = new WeakMap<Node, IPendingVolumeRequest[]>();

/**
 * ルートの state 要素が初期化に失敗した rootNode（#257）。ルート登録（setStateElement）は
 * 二度と起きないので `drainPendingVolumes` も呼ばれず、保留中のボリュームの
 * `onGrafted` が走らないまま initializePromise / connectedCallbackPromise が永久に
 * 未解決になる（ルートの診断だけが出て、同じページのボリュームは無言で消える）。
 * 「ルートは来ない」と確定した時点で保留分を孤児として着地させ、以後に届く保留要求も
 * 同じ着地へ合流させる。D11 の「ルート無し」報告はここには出ない — 検査（State.ts の
 * reportVolumeWithoutRoot）は**要素の存在**で見るので、落ちたルート要素が居る限り黙る。
 *
 * 印は**落ちた要素がこの rootNode に居る間だけ**有効（`clearFailedRootNode`）。持続させると、
 * この PR が案内する復旧（壊れた要素を取り除いて作り直す）と矛盾する: 外してから修正版を
 * 接続するまでの窓で接続したボリュームが即座に孤児化し、正しいルートが来ても採用されない。
 */
const failedRootNodes = new WeakSet<Node>();

/** 接ぎ木先を失ったボリュームの着地（graftIsolated の失敗と同じ形 — 1 件 1 報告 ＋ finish(null)）。 */
function orphanPendingVolume(request: IPendingVolumeRequest): void {
  console.error(
    `[@wcstack/state] volume "${request.mountPath}" was not grafted — the root state element ` +
    `on this root node failed to initialize (its own diagnostic is reported separately). ` +
    `The volume is not at fault: fix the root <wcs-state>.`,
  );
  request.onGrafted(null);
}

/**
 * 失敗の印を落とす（#257）。呼び手は State の `disconnectedCallback` ただ 1 つで、
 * **初期化に失敗した当の要素**が剥がされたときだけ呼ぶ — 落ちたルートが DOM から
 * 消えた時点で「このルートノードにルートは来ない」は成り立たなくなる（作者は
 * 取り除いて作り直す）。
 *
 * 呼び手を本人に限るのは第 3 ラウンドの修正: 「初期化前に剥がされた要素」全部で
 * 落としていたため、同じ rootNode の別要素（登録されなかった 2 本目・行プールの
 * 張り直し・ロード中の DOM 移動）の切断で印が消え、以後のボリュームが孤児報告を
 * 受けられず永久保留へ戻っていた。
 */
export function clearFailedRootNode(rootNode: Node): void {
  failedRootNodes.delete(rootNode);
}

/** ルートの初期化失敗を確定し、保留中のボリュームを孤児として着地させる（State の _failInitializeLoudly が唯一の呼び手）。 */
export function failPendingVolumes(rootNode: Node): void {
  failedRootNodes.add(rootNode);
  const pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined") {
    // 保留はまだ無い（ボリュームのロードのほうが遅い形）— 下の queuePendingVolume が拾う
    return;
  }
  pendingVolumesByRootNode.delete(rootNode);
  for (const request of pending) {
    orphanPendingVolume(request);
  }
}

let graftHandler: ((rootStateElement: IStateElement, request: IPendingVolumeRequest) => void) | null = null;

export function setVolumeGraftHandler(handler: (rootStateElement: IStateElement, request: IPendingVolumeRequest) => void): void {
  graftHandler = handler;
}

export function queuePendingVolume(rootNode: Node, request: IPendingVolumeRequest): void {
  if (failedRootNodes.has(rootNode)) {
    // ルートが落ちた後に届いた保留要求（ボリュームのロードのほうが遅い形）。
    // 積んでも引き取り手は永久に来ない
    orphanPendingVolume(request);
    return;
  }
  let pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined") {
    pending = [];
    pendingVolumesByRootNode.set(rootNode, pending);
  }
  pending.push(request);
}

/** ルート登録時に保留中のボリュームを接ぎ木する（stateElementByName から呼ばれる）。 */
export function drainPendingVolumes(rootNode: Node, rootStateElement: IStateElement): void {
  // ルートが成立した ＝ 失敗の印は無効（落ちたルートを外して正しいルートを接続し直した
  // 形。WeakSet.delete は未登録でも安全なので分岐は要らない）
  failedRootNodes.delete(rootNode);
  const pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined" || pending.length === 0 || graftHandler === null) {
    return;
  }
  pendingVolumesByRootNode.delete(rootNode);
  // 登録はルートの _initialize の途中（createState はまだ危うい）— microtask に
  // 遅らせてルートの接続完了後に接ぎ木する
  const handler = graftHandler;
  queueMicrotask(() => {
    for (const request of pending) {
      handler(rootStateElement, request);
    }
  });
}
